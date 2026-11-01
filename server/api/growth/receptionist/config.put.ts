import { requireReceptionist } from '~/server/utils/requireGrowth'
import { loadReceptionistConfig, loadTypeChoices, readAccountTypes } from '~/server/utils/receptionist'
import { checkBookableIds } from '~/utils/receptionistTypes'
// The languages the prompt can be told the clinic supports: a closed list,
// so the sentence it builds names real languages.
import { RECEPTIONIST_LANGUAGES } from '~/utils/receptionistLanguages'
import type { TablesUpdate } from '~/types/database.types'

interface Body {
  enabled?: unknown
  personaName?: unknown
  languages?: unknown
  tone?: unknown
  neverSays?: unknown
  qualificationQuestions?: unknown
  knowledge?: unknown
  escalationRules?: unknown
  bookingWindowDays?: unknown
  minimumNoticeMinutes?: unknown
  slotsPerReply?: unknown
  bookableAppointmentTypeIds?: unknown
  afterHours?: unknown
  missedCallTextBack?: unknown
  answerDuringHours?: unknown
  noReplyPhrases?: unknown
  monthlyReplyLimit?: unknown
  reactivationAppointmentTypeId?: unknown
  /** The updated_at the screen read (ReceptionistConfig.updatedAt); see LISTS below. */
  ifUpdatedAt?: unknown
}

/**
 * The settings saved as whole lists. A save carrying one of them from a
 * screen opened before somebody else's change writes the old list back over
 * it -- which is how four knowledge cards went missing with nothing to say so
 * (31 Oct 2026) -- so it is refused unless the row is as the screen read it.
 * A switch or a number replaces only itself, and is let through.
 */
const LISTS: (keyof Body)[] = ['knowledge', 'escalationRules', 'qualificationQuestions', 'noReplyPhrases']

const TONES = ['warm_brief', 'clinical', 'chatty', 'formal']

function intInRange(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw createError({ statusCode: 400, statusMessage: `${label} must be a whole number between ${min} and ${max}` })
  }
  return value
}

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireReceptionist(event)
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
  if (body.languages !== undefined) {
    if (!Array.isArray(body.languages)) throw createError({ statusCode: 400, statusMessage: 'languages must be a list' })
    const languages = [...new Set(body.languages.filter((l): l is string => typeof l === 'string' && l in RECEPTIONIST_LANGUAGES))]
    if (!languages.length) throw createError({ statusCode: 400, statusMessage: 'The receptionist needs at least one language' })
    patch.languages = languages
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
    // A card from a template with a blank left in (ReceptionistKnowledgeCard):
    // the model would repeat "Dura unos ___ minutos" to a patient.
    if (JSON.stringify(body.knowledge).includes('___')) throw createError({ statusCode: 400, statusMessage: 'Fill in every ___ on the card before saving it' })
    patch.knowledge = body.knowledge as never
  }
  if (body.escalationRules !== undefined) {
    if (!Array.isArray(body.escalationRules)) throw createError({ statusCode: 400, statusMessage: 'escalationRules must be a list' })
    patch.escalation_rules = body.escalationRules as never
  }
  if (body.bookingWindowDays !== undefined) patch.booking_window_days = intInRange(body.bookingWindowDays, 1, 90, 'Booking window')
  if (body.minimumNoticeMinutes !== undefined) patch.minimum_notice_minutes = intInRange(body.minimumNoticeMinutes, 0, 10080, 'Minimum notice')
  if (body.slotsPerReply !== undefined) patch.slots_per_reply = intInRange(body.slotsPerReply, 1, 5, 'Slots per reply')
  // null clears the ceiling.
  if (body.monthlyReplyLimit !== undefined) patch.monthly_reply_limit = body.monthlyReplyLimit === null ? null : intInRange(body.monthlyReplyLimit, 1, 100000, 'Monthly reply limit')
  // [] is "any active type" (utils/receptionistTypes.ts). The screen sends it
  // only from its "Any type" choice, never as an emptied "only these" list.
  if (body.bookableAppointmentTypeIds !== undefined) {
    const { data: types, error: typesError } = await readAccountTypes(supabase, teamMember.account_id)
    if (typesError) throw createError({ statusCode: 500, statusMessage: typesError.message })
    const checked = checkBookableIds(body.bookableAppointmentTypeIds, types ?? [])
    if ('error' in checked) throw createError({ statusCode: 400, statusMessage: checked.error })
    patch.bookable_appointment_type_ids = checked.ids
  }
  // null clears it. One of the account's own active types, or refused.
  if (body.reactivationAppointmentTypeId !== undefined) {
    if (body.reactivationAppointmentTypeId === null) patch.reactivation_appointment_type_id = null
    else {
      const id = body.reactivationAppointmentTypeId
      const { data: types, error: typesError } = await readAccountTypes(supabase, teamMember.account_id)
      if (typesError) throw createError({ statusCode: 500, statusMessage: typesError.message })
      if (typeof id !== 'string' || !(types ?? []).some((type) => type.id === id && !type.archived_at)) throw createError({ statusCode: 400, statusMessage: 'Unknown appointment type for reactivation' })
      patch.reactivation_appointment_type_id = id
    }
  }
  if (body.afterHours !== undefined) patch.after_hours = Boolean(body.afterHours)
  if (body.missedCallTextBack !== undefined) patch.missed_call_text_back = Boolean(body.missedCallTextBack)
  if (body.answerDuringHours !== undefined) patch.answer_during_hours = Boolean(body.answerDuringHours)
  if (body.noReplyPhrases !== undefined) {
    if (!Array.isArray(body.noReplyPhrases)) throw createError({ statusCode: 400, statusMessage: 'noReplyPhrases must be a list' })
    patch.no_reply_phrases = [...new Set(body.noReplyPhrases.filter((p): p is string => typeof p === 'string').map((p) => p.trim().slice(0, 60)).filter(Boolean))].slice(0, 40) as never
  }

  if (Object.keys(patch).length === 0) throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })

  // In the update itself, so nothing can land between the check and the write.
  const guarded = typeof body.ifUpdatedAt === 'string' && LISTS.some((key) => body[key] !== undefined)
  let update = supabase.from('receptionist_config').update(patch).eq('account_id', teamMember.account_id)
  if (guarded) update = update.eq('updated_at', body.ifUpdatedAt as string)
  const { data: written, error } = await update.select('account_id')
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (guarded && !written?.length) {
    throw createError({ statusCode: 409, statusMessage: 'Someone else changed these settings after you opened this page.' })
  }

  const config = await loadReceptionistConfig(supabase, teamMember.account_id)
  return { config, ...(await loadTypeChoices(supabase, teamMember.account_id, config)) }
})
