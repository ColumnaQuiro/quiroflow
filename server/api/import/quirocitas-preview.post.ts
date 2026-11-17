import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { importJobT } from '~/server/utils/importJobs'
import { loadQuirocitasSnapshot } from '~/server/utils/quirocitasSnapshotStore'
import { quirocitasImporter, QUIROCITAS_STEPS, type QuirocitasStepKind } from '~/utils/quirocitasImport'

// The preview an import step shows before Apply: what it would write from the
// copy read from Quirocitas, against what is already here. Planned with the
// same code the import job writes with (utils/quirocitasImport.ts), and never
// applied here. The copy itself stays on the server; only the preview -- its
// counts, warnings and a sample of rows -- comes back.
const SAMPLE_ROWS = 200

export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const accountId = teamMember.account_id
  const body = await readBody<{ kind?: string; clinicId?: string | null; quietUpcoming?: boolean; lang?: string }>(event)
  const kind = body?.kind as QuirocitasStepKind
  if (!QUIROCITAS_STEPS.includes(kind)) throw createError({ statusCode: 400, statusMessage: 'kind' })

  const admin = serverSupabaseServiceRole<Database>(event)
  let clinicId: string | null = null
  if (body.clinicId) {
    const { data } = await admin.from('clinics').select('id').eq('id', body.clinicId).eq('account_id', accountId).maybeSingle()
    clinicId = data?.id ?? null
  }
  const snapshot = await loadQuirocitasSnapshot(admin, accountId)
  if (!snapshot) throw createError({ statusCode: 409, statusMessage: 'Read Quirocitas first.' })

  const importer = quirocitasImporter({
    supabase: admin,
    accountId,
    clinicId,
    t: importJobT(body.lang),
    // A preview never applies, so never fetches or compresses anything.
    fetchFile: () => Promise.reject(new Error('preview')),
    compressFile: () => Promise.resolve(),
  })
  const plan = await importer.plan(kind, snapshot, { quietUpcoming: body.quietUpcoming !== false })
  return {
    stats: plan.stats,
    columns: plan.columns,
    rows: plan.rows.slice(0, SAMPLE_ROWS),
    rowCount: plan.rows.length,
    warnings: plan.warnings,
    total: plan.total,
  }
})
