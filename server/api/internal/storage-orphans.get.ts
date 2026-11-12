import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// What is in Storage for this clinic that no row points at. Read-only.
//
// Per bucket: how many objects and bytes sit under the account's folder, and
// how many of those nothing references, with the rule that was applied
// (storage_orphan_report, 20261112070000). `orphan_objects` is null for a
// bucket there is no rule for -- its objects are named from inside HTML or
// JSON -- which is not the same as zero.
//
// It deletes nothing and there is deliberately no route that does: a wrong
// rule in a sweeper destroys clinical files. Same gate as the other bulk file
// tool, /api/internal/compress-existing-files.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const service = serverSupabaseServiceRole<Database>(event)
  const { data, error } = await service.rpc('storage_orphan_report', { p_account_id: teamMember.account_id })
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const buckets = data ?? []
  return {
    accountId: teamMember.account_id,
    buckets,
    totals: {
      objects: buckets.reduce((n, b) => n + Number(b.objects), 0),
      bytes: buckets.reduce((n, b) => n + Number(b.bytes), 0),
      orphanObjects: buckets.reduce((n, b) => n + Number(b.orphan_objects ?? 0), 0),
      orphanBytes: buckets.reduce((n, b) => n + Number(b.orphan_bytes ?? 0), 0),
    },
  }
})
