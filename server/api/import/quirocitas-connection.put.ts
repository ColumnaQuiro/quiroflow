import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { setAccountSecret } from '~/server/utils/accountSecrets'
import { normaliseQuirocitasUrl } from '~/server/utils/quirocitas'

// Saves the Quirocitas connection: the clinic's address and a staff login.
// The password is write-only; leaving it empty keeps the one already stored.
// Any saved session is dropped, so the next call signs in with what was just
// saved rather than a session belonging to the previous login.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const body = await readBody<{ baseUrl?: string; username?: string; password?: string }>(event)
  const baseUrl = normaliseQuirocitasUrl(body?.baseUrl ?? '')
  // The server signs in wherever this points, so it may only point at a
  // Quirocitas: never an IP address, an internal name, or anything else.
  if (!baseUrl || !/quirocitas/i.test(new URL(baseUrl).hostname) || /^[\d.:[\]]+$/.test(new URL(baseUrl).hostname)) {
    throw createError({ statusCode: 400, statusMessage: 'The Quirocitas address is the https:// address you log in at, e.g. https://quirocitas-yourclinic.es/chiro' })
  }
  const username = (body?.username ?? '').trim()
  if (!username) throw createError({ statusCode: 400, statusMessage: 'Enter the Quirocitas username.' })
  const password = body?.password ?? ''

  const admin = serverSupabaseServiceRole<Database>(event)
  await setAccountSecret(admin, teamMember.account_id, 'quirocitas_base_url', baseUrl)
  await setAccountSecret(admin, teamMember.account_id, 'quirocitas_username', username)
  if (password) await setAccountSecret(admin, teamMember.account_id, 'quirocitas_password', password)
  await admin.from('account_secrets').delete().eq('account_id', teamMember.account_id).in('name', ['quirocitas_session', 'quirocitas_ledger_cursor'])
  return { ok: true, baseUrl }
})
