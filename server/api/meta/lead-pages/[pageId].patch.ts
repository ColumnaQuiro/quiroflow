import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { loose } from '~/server/utils/publicApiHandlers'

// The one setting a connected Page has: whether submitting its forms counts
// as marketing consent when the form itself asks nothing. Through a route
// rather than a table update from the page, because members can only read
// lead_ad_pages -- the rest of the row is the connection's own bookkeeping.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  const pageId = getRouterParam(event, 'pageId') ?? ''
  const body = await readBody<{ formSubmissionIsConsent?: unknown }>(event)
  if (typeof body?.formSubmissionIsConsent !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'formSubmissionIsConsent must be true or false.' })
  }

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data, error } = await loose(admin)
    .from('lead_ad_pages')
    .update({ form_submission_is_consent: body.formSubmissionIsConsent } as never)
    .eq('page_id', pageId)
    .eq('account_id', teamMember.account_id)
    .select('page_id')
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!data?.length) throw createError({ statusCode: 404, statusMessage: 'That Page is not connected to this account.' })
  return { formSubmissionIsConsent: body.formSubmissionIsConsent }
})
