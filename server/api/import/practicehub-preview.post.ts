import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { importJobT } from '~/server/utils/importJobs'
import { loadPracticeHubSnapshot } from '~/server/utils/practicehubSnapshotStore'
import { planPracticeHubStep, PRACTICEHUB_STEPS, type PracticeHubStepKind } from '~/utils/practicehubImport'

// What a PracticeHub import step would write from the copy the server read
// (import_snapshots), against what is already here -- planned with the same
// code the import job writes with (utils/practicehubImport), and never
// applied. Only the preview -- counts, warnings and a sample of rows -- comes
// back; the copy itself stays on the server. The Quirocitas twin is
// quirocitas-preview.post.ts.
const SAMPLE_ROWS = 200

export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const accountId = teamMember.account_id
  const body = await readBody<{ kind?: string; clinicId?: string | null; lang?: string }>(event)
  const kind = body?.kind as PracticeHubStepKind
  if (!PRACTICEHUB_STEPS.includes(kind)) throw createError({ statusCode: 400, statusMessage: 'kind' })

  const admin = serverSupabaseServiceRole<Database>(event)
  let clinicId: string | null = null
  if (body.clinicId) {
    const { data } = await admin.from('clinics').select('id').eq('id', body.clinicId).eq('account_id', accountId).maybeSingle()
    clinicId = data?.id ?? null
  }
  const snapshot = await loadPracticeHubSnapshot(admin, accountId)
  if (!snapshot) throw createError({ statusCode: 409, statusMessage: 'Read PracticeHub first.' })
  const { data: account } = await admin.from('accounts').select('default_phone_country').eq('id', accountId).maybeSingle()

  const plan = await planPracticeHubStep(kind, {
    supabase: admin,
    accountId,
    clinicId,
    defaultPhoneCountry: account?.default_phone_country || 'ES',
    t: importJobT(body.lang),
  }, snapshot)
  return {
    readAt: snapshot.readAt,
    stats: plan.stats,
    columns: plan.columns,
    rows: plan.rows.slice(0, SAMPLE_ROWS),
    rowCount: plan.rows.length,
    warnings: plan.warnings,
    total: plan.total,
  }
})
