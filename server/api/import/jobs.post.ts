import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { quirocitasLogin } from '~/server/utils/quirocitas'
import { startImportSlice } from '~/server/utils/importJobs'
import { QUIROCITAS_STEPS } from '~/utils/quirocitasImport'
import { PRACTICEHUB_STEPS } from '~/utils/practicehubImport/types'
import { practiceHubSavedConnection } from '~/server/utils/practicehubImportJob'

// Starts an import job on the server (server/utils/importJobs.ts) and returns
// it at once: the browser only watches import_jobs from here on, and can be
// closed. One step from the step-by-step screens, the read, or everything in
// order -- "Import everything". Quirocitas or PracticeHub.
const ORDER: Record<string, string[]> = {
  quirocitas: ['read', ...QUIROCITAS_STEPS],
  practicehub: ['read', ...PRACTICEHUB_STEPS],
}

export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const accountId = teamMember.account_id
  const body = await readBody<{ source?: string; steps?: string[]; clinicId?: string | null; options?: { lang?: string; quietUpcoming?: boolean; fromScratch?: boolean; dryRun?: boolean } }>(event)
  const source = body?.source
  if (source !== 'quirocitas' && source !== 'practicehub') throw createError({ statusCode: 400, statusMessage: 'Unknown source' })

  // Always in the order they depend on each other, whatever order they came in.
  const asked = new Set(body.steps ?? [])
  const steps = ORDER[source]!.filter((s) => asked.has(s))
  if (!steps.length || asked.size !== steps.length) throw createError({ statusCode: 400, statusMessage: 'steps' })

  const admin = serverSupabaseServiceRole<Database>(event)
  if (source === 'quirocitas' && !(await quirocitasLogin(admin, accountId))) throw createError({ statusCode: 400, statusMessage: 'Save the Quirocitas connection first.' })
  if (source === 'practicehub' && !(await practiceHubSavedConnection(admin, accountId))) throw createError({ statusCode: 400, statusMessage: 'Save the PracticeHub connection first, in Settings > Import > Connection.' })

  // Appointments are booked into a clinic, and the browser importer always
  // refused to guess which.
  let clinicId: string | null = null
  if (body.clinicId) {
    const { data } = await admin.from('clinics').select('id').eq('id', body.clinicId).eq('account_id', accountId).maybeSingle()
    if (!data) throw createError({ statusCode: 400, statusMessage: 'clinicId' })
    clinicId = data.id
  }
  // PracticeHub's Patients step files new patients under a clinic too, as its
  // screen's clinic dropdown did.
  if ((steps.includes('appointments') || (source === 'practicehub' && steps.includes('patients'))) && !clinicId) {
    throw createError({ statusCode: 400, statusMessage: 'Choose the clinic these appointments belong to, in the clinic switcher in the sidebar.' })
  }

  const o = body.options ?? {}
  const { data: job, error } = await admin
    .from('import_jobs')
    .insert({
      account_id: accountId,
      clinic_id: clinicId,
      source,
      steps,
      options: {
        lang: typeof o.lang === 'string' ? o.lang.slice(0, 5) : 'es',
        quietUpcoming: o.quietUpcoming !== false,
        fromScratch: o.fromScratch === true,
        ...(source === 'practicehub' && o.dryRun === true ? { dryRun: true } : {}),
      },
      started_by: teamMember.id,
    })
    .select('*')
    .single()
  if (error?.code === '23505') throw createError({ statusCode: 409, statusMessage: 'An import is already running for this clinic.' })
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  await startImportSlice(getRequestURL(event).origin, job.id)
  return job
})
