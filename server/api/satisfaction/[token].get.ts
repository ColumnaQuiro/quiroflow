import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { reviewLinkFor, surveyByToken, surveyLocked } from '~/server/utils/satisfactionSurvey'

// The "how did we do?" page loading its survey (/valorar/<token>). No
// session -- the token is the key, as with review and waitlist links.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  if (!token) throw createError({ statusCode: 400, statusMessage: 'Missing token' })
  const supabase = serverSupabaseServiceRole<Database>(event)
  const row = await surveyByToken(supabase, token)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'This link is not valid.' })
  return {
    clinicName: row.appointments?.clinics?.name ?? '',
    firstName: row.appointments?.patients?.first_name ?? '',
    visitAt: row.appointments?.starts_at ?? null,
    score: row.score,
    commented: !!row.comment,
    locked: surveyLocked(row),
    // Only once they have said 4 or 5; the page offers it then.
    reviewUrl: row.score !== null && row.score >= 4 && row.review_offered_at ? await reviewLinkFor(supabase, row, getRequestURL(event).origin) : null,
  }
})
