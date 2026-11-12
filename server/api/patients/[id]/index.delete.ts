import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { collectPatientStoragePaths } from '~/utils/patientFileStorage'

// Deleting a patient, and the files that were theirs.
//
// The dialog used to delete the row from the browser. The rows cascade; the
// Storage objects do not, so every deleted patient left their scans, their
// avatar and their cached PDFs behind with nothing pointing at them --
// clinical files nobody could reach and nobody could remove.
//
// Order is the whole point:
//   1. read every path the patient's rows name, BEFORE the delete (the
//      cascade takes patient_files and posture_assessments with it);
//   2. delete the row as the caller, so RLS (patients_delete_merge, row
//      scope) and the foreign keys decide exactly as they did from the
//      browser -- a patient with a factura or a third-party charge is still
//      refused by the database, and nothing has been removed at that point;
//   3. only then remove the objects, with the service role (the storage
//      delete policy wants patient_files_delete, which is a different
//      permission from deleting a patient). A removal that fails is logged
//      and reported; it never fails or undoes the deletion.
//
// Not removed: whatsapp-media. Messages outlive the patient on purpose
// (whatsapp_messages.patient_id is ON DELETE SET NULL, and the dialog says
// so), and their rows still name that media.
export default defineEventHandler(async (event) => {
  const { supabase, teamMember, patientId } = await requirePatientAccess(event, getRouterParam(event, 'id'))
  if (!teamMember.is_owner) {
    const { data: allowed } = await supabase.rpc('has_permission', { target_account_id: teamMember.account_id, perm_key: 'patients_delete_merge' })
    if (!allowed) throw createError({ statusCode: 403, statusMessage: 'Missing permission: patients_delete_merge' })
  }

  const accountId = teamMember.account_id
  // After the guard, so it carries the caller as the audit actor.
  const service = serverSupabaseServiceRole<Database>(event)

  const [{ data: patient }, { data: files }, { data: posture }] = await Promise.all([
    service.from('patients').select('id, photo_storage_path').eq('id', patientId).eq('account_id', accountId).maybeSingle(),
    service.from('patient_files').select('storage_path, thumb_path').eq('patient_id', patientId).eq('account_id', accountId),
    service.from('posture_assessments').select('views').eq('patient_id', patientId).eq('account_id', accountId),
  ])
  if (!patient) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  const named = collectPatientStoragePaths(accountId, {
    files: files ?? [],
    photo: patient.photo_storage_path,
    postureViews: (posture ?? []).map((p) => p.views),
  })

  const { data: gone, error: deleteError } = await supabase.from('patients').delete().eq('id', patientId).select('id')
  if (deleteError) {
    // 23503: a factura or third-party charge holds the record (RESTRICT).
    throw createError({ statusCode: deleteError.code === '23503' ? 409 : 400, statusMessage: deleteError.message })
  }
  if (!gone?.length) throw createError({ statusCode: 403, statusMessage: 'Your role cannot delete this patient.' })

  // From here on the patient is gone, and nothing below may throw.
  const storage = { removed: 0, failed: 0 }
  try {
    const folder = `${accountId}/${patientId}`
    // These three keep everything of a patient's under <account>/<patient>/,
    // and two of them have no row naming their objects at all.
    const [photos, invoicePdfs, calendarFiles] = await Promise.all([
      listStorageFolder(service, 'patient-photos', folder),
      listStorageFolder(service, 'invoice-pdfs', folder),
      listStorageFolder(service, 'calendar-files', folder),
    ])

    // A path still named by a row that survived is not this patient's to
    // take: after a merge, the survivor's files and photo can live under
    // the other record's folder.
    const filePaths = named['patient-files']
    const stillNamed = new Set<string>()
    for (let i = 0; i < filePaths.length; i += 40) {
      const chunk = filePaths.slice(i, i + 40)
      const [byPath, byThumb] = await Promise.all([
        service.from('patient_files').select('storage_path').eq('account_id', accountId).in('storage_path', chunk),
        service.from('patient_files').select('thumb_path').eq('account_id', accountId).in('thumb_path', chunk),
      ])
      if (byPath.error || byThumb.error) throw byPath.error ?? byThumb.error
      for (const r of byPath.data ?? []) if (r.storage_path) stillNamed.add(r.storage_path)
      for (const r of byThumb.data ?? []) if (r.thumb_path) stillNamed.add(r.thumb_path)
    }
    // An avatar is replaced a handful of times at most; the cap keeps the
    // lookup below inside one URL.
    const photoPaths = [...new Set([...named['patient-photos'], ...photos])].slice(0, 40)
    if (photoPaths.length) {
      const { data: users, error } = await service.from('patients').select('photo_storage_path').eq('account_id', accountId).in('photo_storage_path', photoPaths)
      if (error) throw error
      for (const r of users ?? []) if (r.photo_storage_path) stillNamed.add(r.photo_storage_path)
    }

    const context = `patient ${patientId} deleted`
    const results = await Promise.all([
      removeStorageObjects(service, 'patient-files', filePaths.filter((p) => !stillNamed.has(p)), context),
      removeStorageObjects(service, 'patient-photos', photoPaths.filter((p) => !stillNamed.has(p)), context),
      removeStorageObjects(service, 'invoice-pdfs', invoicePdfs, context),
      removeStorageObjects(service, 'calendar-files', calendarFiles, context),
    ])
    for (const r of results) {
      storage.removed += r.removed
      storage.failed += r.failed.length
    }
  } catch (e) {
    // The "is it still named" check failed: remove nothing rather than guess.
    console.error(`[storage-cleanup] patient ${patientId} deleted, its files were NOT removed`, named, e)
    storage.failed = named['patient-files'].length + named['patient-photos'].length
  }

  return { deleted: true, storage }
})
