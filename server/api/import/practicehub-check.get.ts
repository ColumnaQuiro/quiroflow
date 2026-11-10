import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getAccountSecret } from '~/server/utils/accountSecrets'
import { practiceHubClassicGet } from '~/server/utils/practicehubClassic'

// "Test connection" for the Classic key: what the saved address and key
// reach, in numbers the clinic recognises. PracticeHub 2.0 has had this
// since its key was added; the Classic key, which every import step uses,
// could only be tested by running a step and waiting for it to fail.
//
// Sequential, not Promise.all: the Classic API allows one request a second.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data } = await admin.from('accounts').select('practicehub_base_url, practicehub_contact_email').eq('id', teamMember.account_id).maybeSingle()
  const baseUrl = (data?.practicehub_base_url ?? '').replace(/\/$/, '')
  const apiKey = (await getAccountSecret(admin, teamMember.account_id, 'practicehub_api_key')) ?? ''
  if (!baseUrl || !apiKey) {
    throw createError({ statusCode: 400, statusMessage: 'No PracticeHub connection is saved. Set it up in Settings > Import > Connection.' })
  }
  assertPracticeHubClassicKey(apiKey)
  const conn = { baseUrl, apiKey, appDetails: `QuiroFlow=${data?.practicehub_contact_email ?? ''}` }

  type Page<T> = { data: T[]; total_entries: number }
  type Named = { first_name?: string | null; last_name?: string | null; name?: string | null }
  const practitioners = await practiceHubClassicGet<Page<Named>>(conn, '/practitioners', { page_size: '100' })
  const patients = await practiceHubClassicGet<Page<unknown>>(conn, '/patients', { page_size: '1' })
  const appointments = await practiceHubClassicGet<Page<unknown>>(conn, '/appointments', { page_size: '1' })
  return {
    patients: patients.total_entries ?? null,
    appointments: appointments.total_entries ?? null,
    practitioners: (practitioners.data ?? [])
      .map((p) => (p.name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`).trim())
      .filter(Boolean),
  }
})
