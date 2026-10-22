import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { setAccountSecret } from '~/server/utils/accountSecrets'

// Saves the PracticeHub connection. The key is write-only: stored in
// account_secrets, which grants nothing to `authenticated`. Leaving it empty
// keeps the one already stored.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const body = await readBody<{ baseUrl?: string; contactEmail?: string; apiKey?: string; v3ApiKey?: string }>(event)
  const baseUrl = (body?.baseUrl ?? '').trim().replace(/\/$/, '')
  const contactEmail = (body?.contactEmail ?? '').trim()
  const apiKey = (body?.apiKey ?? '').trim()
  // PracticeHub 2.0's API takes its own `phk_` key; a Classic key there is
  // refused with a bare 401, so say so here instead.
  const v3ApiKey = (body?.v3ApiKey ?? '').trim()
  if (v3ApiKey && !v3ApiKey.startsWith('phk_')) {
    throw createError({ statusCode: 400, statusMessage: 'The PracticeHub 2.0 key starts with phk_. Create one in PracticeHub under Developers > API Keys.' })
  }
  if (baseUrl && !/^https:\/\/[^/]+$/i.test(baseUrl)) {
    throw createError({ statusCode: 400, statusMessage: 'The PracticeHub address is the https:// address of your PracticeHub, e.g. https://your-clinic.practicehub.io' })
  }

  const admin = serverSupabaseServiceRole<Database>(event)
  const { error } = await admin
    .from('accounts')
    .update({ practicehub_base_url: baseUrl || null, practicehub_contact_email: contactEmail || null })
    .eq('id', teamMember.account_id)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (apiKey) await setAccountSecret(admin, teamMember.account_id, 'practicehub_api_key', apiKey)
  if (v3ApiKey) await setAccountSecret(admin, teamMember.account_id, 'practicehub_v3_api_key', v3ApiKey)
  return { ok: true }
})
