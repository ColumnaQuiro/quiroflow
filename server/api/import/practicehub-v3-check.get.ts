import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// "Test connection" for PracticeHub 2.0: which account the saved key reaches,
// and how much is there -- the numbers a clinic recognises, so a key for the
// wrong clinic shows itself before anything is imported.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const conn = await practicehubV3Connection(serverSupabaseServiceRole<Database>(event), teamMember.account_id)
  type Page = { meta?: { total?: number } }
  const [me, patients, carePlans] = await Promise.all([
    practicehubV3Get<{ data: { account?: { name?: string }; scopes?: string[] } }>(conn, '/me'),
    practicehubV3Get<Page>(conn, '/patients', { page_size: '1' }),
    practicehubV3Get<Page>(conn, '/care_plans', { page_size: '1' }),
  ])
  return {
    accountName: me.data?.account?.name ?? null,
    canWrite: (me.data?.scopes ?? []).includes('write'),
    patients: patients.meta?.total ?? null,
    carePlans: carePlans.meta?.total ?? null,
  }
})
