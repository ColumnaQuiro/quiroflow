import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { quirocitasLogin } from '~/server/utils/quirocitas'
import { startImportSlice } from '~/server/utils/importJobs'
import { QUIROCITAS_STEPS } from '~/utils/quirocitasImport'

// Starts an import job on the server (server/utils/importJobs.ts) and returns
// it at once: the browser only watches import_jobs from here on, and can be
// closed. One step from the step-by-step screens, the read, or everything in
// order -- "Import everything".
const ORDER = ['read', ...QUIROCITAS_STEPS]

export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const accountId = teamMember.account_id
  const body = await readBody<{ source?: string; steps?: string[]; clinicId?: string | null; options?: { lang?: string; quietUpcoming?: boolean; fromScratch?: boolean } }>(event)
  if (body?.source !== 'quirocitas') throw createError({ statusCode: 400, statusMessage: 'Unknown source' })

  // Always in the order they depend on each other, whatever order they came in.
  const asked = new Set(body.steps ?? [])
  const steps = ORDER.filter((s) => asked.has(s))
  if (!steps.length || asked.size !== steps.length) throw createError({ statusCode: 400, statusMessage: 'steps' })

  const admin = serverSupabaseServiceRole<Database>(event)
  if (!(await quirocitasLogin(admin, accountId))) throw createError({ statusCode: 400, statusMessage: 'Save the Quirocitas connection first.' })

  // Appointments are booked into a clinic, and the browser importer always
  // refused to guess which.
  let clinicId: string | null = null
  if (body.clinicId) {
    const { data } = await admin.from('clinics').select('id').eq('id', body.clinicId).eq('account_id', accountId).maybeSingle()
    if (!data) throw createError({ statusCode: 400, statusMessage: 'clinicId' })
    clinicId = data.id
  }
  if (steps.includes('appointments') && !clinicId) {
    throw createError({ statusCode: 400, statusMessage: 'Choose the clinic these appointments belong to, in the clinic switcher in the sidebar.' })
  }

  const o = body.options ?? {}
  const { data: job, error } = await admin
    .from('import_jobs')
    .insert({
      account_id: accountId,
      clinic_id: clinicId,
      source: 'quirocitas',
      steps,
      options: { lang: typeof o.lang === 'string' ? o.lang.slice(0, 5) : 'es', quietUpcoming: o.quietUpcoming !== false, fromScratch: o.fromScratch === true },
      started_by: teamMember.id,
    })
    .select('*')
    .single()
  if (error?.code === '23505') throw createError({ statusCode: 409, statusMessage: 'An import is already running for this clinic.' })
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  await startImportSlice(getRequestURL(event).origin, job.id)
  return job
})
