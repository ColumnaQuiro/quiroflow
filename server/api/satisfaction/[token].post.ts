import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { alertOwners, reviewLinkFor, surveyByToken, surveyLocked } from '~/server/utils/satisfactionSurvey'

// The patient answering: a score from 1 to 5 (saved the moment it is
// tapped), then, for a 1-3, what to improve. Either can change for
// SURVEY_EDIT_HOURS after the first answer. A first low score -- or a change
// down to one -- tells the owners (alertOwners); a 4-5 gets the clinic's
// Google review link back to offer.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  if (!token) throw createError({ statusCode: 400, statusMessage: 'Missing token' })
  const body = await readBody<{ score?: number; comment?: string }>(event)
  const score = body?.score === undefined ? undefined : Number(body.score)
  if (score !== undefined && !(Number.isInteger(score) && score >= 1 && score <= 5)) throw createError({ statusCode: 400, statusMessage: 'The score is from 1 to 5.' })
  const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 2000) : undefined
  if (score === undefined && comment === undefined) throw createError({ statusCode: 400, statusMessage: 'Nothing to save.' })

  const supabase = serverSupabaseServiceRole<Database>(event)
  const row = await surveyByToken(supabase, token)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'This link is not valid.' })
  if (surveyLocked(row)) throw createError({ statusCode: 409, statusMessage: 'This answer can no longer be changed.' })
  if (score === undefined && row.score === null) throw createError({ statusCode: 400, statusMessage: 'Choose a score first.' })

  const now = new Date().toISOString()
  const next = score ?? row.score!
  const patch: Record<string, unknown> = {}
  if (score !== undefined) {
    patch.score = score
    patch.answered_at = row.answered_at ?? now
    if (score >= 4 && !row.review_offered_at) patch.review_offered_at = now
  }
  if (comment !== undefined) patch.comment = comment || null
  const { error } = await supabase.from('satisfaction_surveys').update(patch as never).eq('id', row.id)
  if (error) throw createError({ statusCode: 500, statusMessage: "Couldn't save the answer." })

  const wasLow = row.score !== null && row.score <= 3
  if (score !== undefined && score <= 3 && !wasLow) await alertOwners(supabase, row, score)

  const reviewUrl = next >= 4 ? await reviewLinkFor(supabase, row, getRequestURL(event).origin) : null
  return { score: next, reviewUrl }
})
