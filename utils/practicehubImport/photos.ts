import { readAllForAccount } from '~/utils/practicehubImport/appointments'
import { eachPracticeHubDownload, practiceHubDownloadErrorText } from '~/utils/practicehubImport/downloads'
import { practiceHubList, type PracticeHubPlan, type PracticeHubStepPlanner } from '~/utils/practicehubImport/types'
import { planProfilePhotos, practiceHubPhotoPath, sniffImageType, type PhotoTargetPatient, type PracticeHubPhotoSource } from '~/utils/practicehubProfilePhotos'

// The Profile photos step of a PracticeHub import, run on the server. It is
// bringPhotos in components/import/PracticeHubPatientsImporter.vue without
// the tab: the same choice of who gets one (planProfilePhotos), the same
// bytes-decide rule for what is a picture (sniffImageType), the same shrink
// (ctx.files.shrinkPhoto, the server's version of the canvas), and the same
// storage path, so a photo the browser brought and one the server brings are
// the same object.
//
// /patients is read again, fresh, right before this step
// (PRACTICEHUB_LINK_LISTS): its profile_image links are signed and expire
// within the hour, so the copy the job read at the start is no use here.
//
// A patient who already has a photo here is left alone, whoever put it there,
// and that is also what makes a second run plan nothing: every photo stored
// has set photo_storage_path. A photo that fails does not fail the step; the
// next run plans it again.

/** Photos fetched at once. The browser fetched six; they are a few MB each before shrinking. */
const CONCURRENCY = 6

type PhotoSource = PracticeHubPhotoSource & { first_name?: string | null; last_name?: string | null }

export const planPracticeHubProfilePhotos: PracticeHubStepPlanner = async (ctx, snapshot): Promise<PracticeHubPlan> => {
  const { supabase, accountId, t } = ctx
  const nf = new Intl.NumberFormat('es-ES')

  const phPatients = practiceHubList<PhotoSource>(snapshot, '/patients')
  const ours = await readAllForAccount<PhotoTargetPatient>(supabase, accountId, 'patients', 'id, external_reference, photo_storage_path', (q) => q.not('external_reference', 'is', null))
  const { queue, alreadyHere } = planProfilePhotos(phPatients, ours)

  const phById = new Map(phPatients.map((p) => [String(p.id), p]))
  const nameOf = (phPatientId: number | string) => {
    const p = phById.get(String(phPatientId))
    return [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() || `#${phPatientId}`
  }
  const withPhoto = phPatients.filter((p) => typeof p.profile_image === 'string' && p.profile_image.trim()).length
  const notHere = withPhoto - queue.length - alreadyHere

  return {
    stats: [
      { label: t('Photos to bring', 'Fotos por traer'), value: nf.format(queue.length), tone: 'good' },
      { label: t('Already have a photo here', 'Ya tienen foto aquí'), value: nf.format(alreadyHere) },
    ],
    columns: [
      { key: 'patient', label: t('Patient', 'Paciente') },
      { key: 'number', label: t('PracticeHub number', 'Número en PracticeHub') },
    ],
    rows: queue.map((item) => ({ patient: nameOf(item.phPatientId), number: String(phById.get(String(item.phPatientId))?.patient_number ?? '') })),
    warnings: [
      t(
        'A patient who already has a photo here keeps it, whether it came from an earlier import or was taken in QuiroFlow.',
        'Un paciente que ya tiene foto aquí la conserva, venga de una importación anterior o se hiciera en QuiroFlow.',
      ),
      ...(notHere > 0 ? [t(
        `${nf.format(notHere)} photos belong to patients not here yet: run Patients first.`,
        `${nf.format(notHere)} fotos son de pacientes que aún no están aquí: ejecuta antes Pacientes.`,
      )] : []),
    ],
    total: queue.length,

    async apply(progress, shouldStop) {
      const files = ctx.files
      if (!files) {
        return { written: 0, errors: [t('Photos are not downloaded in a preview.', 'En una vista previa no se descargan fotos.')] }
      }
      let written = 0
      let notImages = 0
      const failures: string[] = []

      const linksExpired = await eachPracticeHubDownload(queue, { concurrency: CONCURRENCY, shouldStop, progress }, async (item) => {
        const { bytes } = await files.fetch(item.url)
        // What PracticeHub holds as the photo is not always a picture (one
        // was a 2 MB PDF), so the bytes decide -- shrinkPhoto checks them.
        const photo = await files.shrinkPhoto(bytes)
        if (!photo) {
          notImages++
          return
        }
        const extension = sniffImageType(photo.bytes)?.extension ?? 'jpg'
        const path = practiceHubPhotoPath(accountId, item.patientId, extension)
        const { error: uploadError } = await supabase.storage.from('patient-photos').upload(path, photo.bytes, { contentType: photo.contentType, upsert: true })
        if (uploadError) throw new Error(uploadError.message)
        // Only where there is still none: a photo taken here since the plan
        // is the one reception chose.
        const { data, error } = await supabase
          .from('patients')
          .update({ photo_storage_path: path })
          .eq('id', item.patientId)
          .eq('account_id', accountId)
          .is('photo_storage_path', null)
          .select('id')
        if (error) throw new Error(error.message)
        written += data?.length ?? 0
      }, (_item, e) => failures.push(practiceHubDownloadErrorText(e, t)))

      const errors: string[] = []
      if (failures.length) {
        errors.push(t(
          `Profile photos not copied: ${failures.length} (${failures[0]}). Run this step again to retry them.`,
          `Fotos de perfil sin copiar: ${failures.length} (${failures[0]}). Vuelve a ejecutar este paso para reintentarlas.`,
        ))
      }
      if (notImages) {
        errors.push(t(
          `${notImages} patients have something other than a picture as their photo in PracticeHub (a PDF, for one), so it was left out.`,
          `${notImages} pacientes tienen como foto en PracticeHub algo que no es una imagen (un PDF, por ejemplo), así que se ha omitido.`,
        ))
      }
      return linksExpired ? { written, errors, linksExpired: true } : { written, errors }
    },
  }
}
