import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { buildPatientExport } from '~/server/utils/patientExport'
import { logPatientAccess } from '~/server/utils/patientAccessLog'

// "Exportar sus datos (RGPD)" on the patient record: a ZIP of everything held
// about them (server/utils/patientExport.ts), for a right of access request.
// Owners only: answering one is the data controller's act, and the ZIP holds
// the whole clinical record.
//
// Too big to return directly (a function answers at most ~6 MB, and a
// record's photos and PDFs pass that), so it is stored privately under the
// clinic's own folder of patient-files and handed back as a link valid for
// an hour. Older exports in that folder are removed first: a copy of someone's
// record should not outlive the request it answered. Logged in the patient's
// access log as an export, with what went in.
const LINK_SECONDS = 3600
const KEEP_HOURS = 24

export default defineEventHandler(async (event) => {
  const patientId = getRouterParam(event, 'id')
  if (!patientId) throw createError({ statusCode: 400, statusMessage: 'Missing patient' })
  const { supabase, teamMember } = await requireActiveAccount(event)
  if (!teamMember.is_owner) throw createError({ statusCode: 403, statusMessage: 'Only an owner can export a patient’s data.' })

  const service = serverSupabaseServiceRole<Database>(event)
  const [{ data: account }, { data: me }] = await Promise.all([
    service.from('accounts').select('name').eq('id', teamMember.account_id).maybeSingle(),
    service.from('team_members').select('full_name').eq('id', teamMember.id).maybeSingle(),
  ])
  const built = await buildPatientExport(supabase, patientId, { clinicName: account?.name ?? '', requestedBy: me?.full_name ?? '' })
  if (!built) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })

  const folder = `${teamMember.account_id}/exports`
  const { data: old } = await service.storage.from('patient-files').list(folder, { limit: 100 })
  const stale = (old ?? []).filter((f) => f.created_at && Date.now() - Date.parse(f.created_at) > KEEP_HOURS * 3_600_000).map((f) => `${folder}/${f.name}`)
  if (stale.length) await service.storage.from('patient-files').remove(stale)

  const path = `${folder}/${Date.now()}-${built.fileName}`
  const { error: uploadError } = await service.storage.from('patient-files').upload(path, built.zip, { contentType: 'application/zip' })
  if (uploadError) throw createError({ statusCode: 500, statusMessage: 'Could not store the export.' })
  const { data: signed } = await service.storage.from('patient-files').createSignedUrl(path, LINK_SECONDS, { download: built.fileName })
  if (!signed?.signedUrl) throw createError({ statusCode: 500, statusMessage: 'Could not create the download link.' })

  await logPatientAccess(supabase, teamMember.account_id, 'export', patientId, { gdpr: true, ...built.counts })
  return { url: signed.signedUrl, fileName: built.fileName, counts: built.counts, expiresInSeconds: LINK_SECONDS }
})
