import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { webchatAccountBySlug } from '~/server/utils/webchat'

// What the website widget needs before it shows its button: whether this
// clinic's chat is on, and what to call it. Nothing else about the account.
export default defineEventHandler(async (event) => {
  const slug = String(getRouterParam(event, 'slug') ?? '')
  const account = await webchatAccountBySlug(serverSupabaseServiceRole<Database>(event), slug)
  // The same answer for "no such clinic" and "chat switched off".
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Chat not available' })
  return { clinicName: account.name, greeting: account.webchat_greeting }
})
