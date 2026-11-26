import type { TablesInsert } from '~/types/database.types'
import { readAllForAccount } from '~/utils/practicehubImport/appointments'
import { eachPracticeHubDownload, practiceHubDownloadErrorText, PRACTICEHUB_DOWNLOAD_UNFINISHED, PRACTICEHUB_LARGE_FILE_BYTES } from '~/utils/practicehubImport/downloads'
import { practiceHubList, type PracticeHubPlan, type PracticeHubStepPlanner } from '~/utils/practicehubImport/types'
import { sanitizeStorageFilename } from '~/utils/storageFilename'
import { withDeadline } from '~/utils/withDeadline'

// The File attachments step of a PracticeHub import: every patient file from
// PracticeHub's /files, stored against the right patient here. The browser
// importer (components/import/PracticeHubFilesImporter.vue) does the same
// from an open tab, and the rules both share -- which files to bring, where
// each is stored, what it is called -- are the ones below; the component
// imports them from here.
//
// On the server, /files is read again right before this step
// (PRACTICEHUB_LINK_LISTS), because its pre-signed download links expire
// within the hour; a download that finds one expired anyway stops the step,
// and the job reads the list once more and runs it again.
//
// Resumable by construction: a file already carrying a storage_path is
// skipped, so a second run -- or the next slice of this one -- plans only
// what is still missing.

// --- PracticeHub's rows, as the Classic API sends them ---------------------------------

export interface PracticeHubFile {
  id: number
  size: number | null
  file_name: string | null
  entity_type: string | null
  file_type: string | null
  description: string | null
  mime_type: string | null
  patient_id: number | null
  url: string | null
  created: string | null
}
export interface PracticeHubFilePatient {
  id: number
  patient_number: string | number | null
}

// --- shared with the browser importer ------------------------------------------------

export interface PracticeHubFileQueueItem { ph: PracticeHubFile; patientId: string }

export interface PracticeHubFileTriage {
  queue: PracticeHubFileQueueItem[]
  alreadyHere: number
  // Three different reasons, counted separately. They were one bucket called
  // "No patient match", which then reported 688 of 2,624 and told the clinic
  // to run the Patients import -- advice that was wrong, and unfalsifiable
  // from the screen: a file with no download URL landed in the same number as
  // a file whose patient was genuinely absent.
  noPatientMatch: number
  /**
   * Files whose patient PracticeHub no longer lists at all. Its /patients
   * endpoint leaves deleted patients out while their files stay behind, so the
   * Patients import never saw them and running it again changes nothing.
   */
  patientDeletedInPh: number
  noDownloadUrl: number
  notPatientFiles: number
  /** Which PracticeHub patients could not be found, so the clinic can go and look at one. Capped: a hint, not a report. */
  unmatchedPhPatients: number[]
}

const UNMATCHED_SHOWN = 12

/**
 * Which of PracticeHub's files to bring, and why each of the rest is not.
 *
 * A file names its patient by PracticeHub's internal id; our patients carry
 * the patient NUMBER as external_reference. /patients is the only place both
 * appear together, so it is the bridge between them.
 *
 * `ourPatients` and `existing` must be COMPLETE -- every row, not the first
 * 1,000 PostgREST hands back without saying so. A truncated patient list made
 * 688 files report "Patient not here"; a truncated `existing` would have
 * re-downloaded roughly 1,500 files the clinic already had.
 */
export function practiceHubFileTriage(
  phFiles: PracticeHubFile[],
  phPatients: PracticeHubFilePatient[],
  ourPatients: { id: string; external_reference: string | null }[],
  existing: { external_reference: string | null; storage_path: string | null }[],
): PracticeHubFileTriage {
  const phPatientIds = new Set(phPatients.map((p) => String(p.id)))
  const numberByPhId = new Map<string, string>()
  for (const p of phPatients) {
    const ref = String(p.patient_number ?? '').trim()
    if (ref) numberByPhId.set(String(p.id), ref)
  }
  const idByNumber = new Map<string, string>()
  for (const p of ourPatients) {
    const ref = String(p.external_reference ?? '').trim()
    if (ref) idByNumber.set(ref, p.id)
  }
  // Files already carrying their bytes are skipped, which is what makes this
  // resumable -- and what lets it run again after a clinic adds more in
  // PracticeHub without re-downloading everything. A placeholder row (name
  // and size, no content) is not "here": it is filled in.
  const storedRefs = new Set(existing.filter((r) => r.storage_path && r.external_reference).map((r) => String(r.external_reference)))

  const triage: PracticeHubFileTriage = { queue: [], alreadyHere: 0, noPatientMatch: 0, patientDeletedInPh: 0, noDownloadUrl: 0, notPatientFiles: 0, unmatchedPhPatients: [] }
  for (const f of phFiles) {
    // PracticeHub attaches files to things other than patients; only a
    // patient's belong on a patient record here.
    if (f.entity_type && f.entity_type !== 'patient') {
      triage.notPatientFiles++
      continue
    }
    if (storedRefs.has(String(f.id))) {
      triage.alreadyHere++
      continue
    }
    const number = f.patient_id === null ? null : numberByPhId.get(String(f.patient_id))
    const patientId = number ? idByNumber.get(number) : undefined
    if (!patientId && f.patient_id !== null && !phPatientIds.has(String(f.patient_id))) {
      triage.patientDeletedInPh++
      continue
    }
    if (!patientId) {
      triage.noPatientMatch++
      if (f.patient_id !== null && triage.unmatchedPhPatients.length < UNMATCHED_SHOWN && !triage.unmatchedPhPatients.includes(f.patient_id)) {
        triage.unmatchedPhPatients.push(f.patient_id)
      }
      continue
    }
    // Nothing to do with the patient: PracticeHub gave us no link to fetch.
    if (!f.url) {
      triage.noDownloadUrl++
      continue
    }
    triage.queue.push({ ph: f, patientId })
  }
  return triage
}

/** The name an imported file goes by. */
export const practiceHubFileName = (f: Pick<PracticeHubFile, 'id' | 'file_name'>) => f.file_name?.trim() || `practicehub-${f.id}`

/**
 * Where an imported file is stored. Keyed on PracticeHub's file id, not the
 * clock: Date.now() alone collides when one patient has two files of the same
 * name stored in the same millisecond, and a clock-based path took a fresh
 * key every attempt, so a file fetched twice left its first upload behind with
 * nothing pointing at it. Fixed, and uploaded with upsert, a retry writes the
 * same object again. The name is made safe for Storage, which refuses keys
 * with accented characters outright.
 */
export function practiceHubFileStoragePath(accountId: string, patientId: string, f: Pick<PracticeHubFile, 'id' | 'file_name'>): string {
  return `${accountId}/${patientId}/${f.id}-${sanitizeStorageFilename(practiceHubFileName(f))}`
}

// --- the step ------------------------------------------------------------------------

/** Files copied at once. Some are scans of 25 MB or videos, and a function has only so much memory. */
const CONCURRENCY = 3
/**
 * How long a stored file's compression is waited for. It is the same step an
 * upload takes, and a file that fails or outlasts this is imported all the
 * same: compressed_at stays empty and Settings › Files picks it up.
 */
const COMPRESS_WAIT_MS = 10_000

export const planFileAttachments: PracticeHubStepPlanner = async (ctx, snapshot): Promise<PracticeHubPlan> => {
  const { supabase, accountId, t } = ctx
  const nf = new Intl.NumberFormat('es-ES')

  const phFiles = practiceHubList<PracticeHubFile>(snapshot, '/files')
  const phPatients = practiceHubList<PracticeHubFilePatient>(snapshot, '/patients')
  const [ourPatients, existing] = await Promise.all([
    readAllForAccount<{ id: string; external_reference: string | null }>(supabase, accountId, 'patients', 'id, external_reference', (q) => q.not('external_reference', 'is', null)),
    readAllForAccount<{ external_reference: string | null; storage_path: string | null }>(supabase, accountId, 'patient_files', 'id, external_reference, storage_path', (q) => q.not('external_reference', 'is', null)),
  ])
  const triage = practiceHubFileTriage(phFiles, phPatients, ourPatients, existing)
  const { queue } = triage
  const ids = triage.unmatchedPhPatients.length
    ? ` ${triage.unmatchedPhPatients.join(', ')}${triage.noPatientMatch > triage.unmatchedPhPatients.length ? '…' : ''}`
    : ''
  const kb = (bytes: number | null) => (bytes == null ? '' : `${nf.format(Math.max(1, Math.round(bytes / 1024)))} KB`)

  return {
    stats: [
      { label: t('In PracticeHub', 'En PracticeHub'), value: nf.format(phFiles.length) },
      { label: t('To bring over', 'Por traer'), value: nf.format(queue.length), tone: 'good' },
      { label: t('Already here', 'Ya están'), value: nf.format(triage.alreadyHere) },
      { label: t('No patient here', 'Sin paciente aquí'), value: nf.format(triage.noPatientMatch) },
    ],
    columns: [
      { key: 'file', label: t('File', 'Archivo'), wrap: true },
      { key: 'type', label: t('Type', 'Tipo') },
      { key: 'size', label: t('Size', 'Tamaño') },
    ],
    rows: queue.map((item) => ({ file: practiceHubFileName(item.ph), type: item.ph.mime_type ?? '', size: kb(item.ph.size) })),
    warnings: [
      ...(triage.notPatientFiles ? [t(
        `${nf.format(triage.notPatientFiles)} files in PracticeHub belong to something other than a patient (reports and data exports) and are left alone.`,
        `${nf.format(triage.notPatientFiles)} archivos de PracticeHub no son de un paciente (informes y exportaciones) y se dejan como están.`,
      )] : []),
      ...(triage.patientDeletedInPh ? [t(
        `${nf.format(triage.patientDeletedInPh)} files belong to patients deleted in PracticeHub, so there is no patient to attach them to. They are left alone.`,
        `${nf.format(triage.patientDeletedInPh)} archivos son de pacientes eliminados en PracticeHub, así que no hay paciente al que asociarlos. Se dejan como están.`,
      )] : []),
      ...(triage.noDownloadUrl ? [t(
        `${nf.format(triage.noDownloadUrl)} files have a patient here but no download link from PracticeHub, so there is nothing to fetch.`,
        `${nf.format(triage.noDownloadUrl)} archivos tienen paciente aquí pero PracticeHub no dio enlace de descarga, así que no hay nada que traer.`,
      )] : []),
      // Says what was not found instead of asserting why: the first version
      // of the browser screen told the clinic to run Patients, on an account
      // where 1,530 of PracticeHub's 1,535 patients were already here.
      // Two t() calls: the catalogue only translates what reaches t() whole.
      ...(triage.noPatientMatch ? [t(
        `${nf.format(triage.noPatientMatch)} files name a PracticeHub patient who is not in QuiroFlow: usually one added to PracticeHub since Patients last ran, or one deleted here.`,
        `${nf.format(triage.noPatientMatch)} archivos indican un paciente de PracticeHub que no está en QuiroFlow: normalmente uno añadido en PracticeHub desde la última vez que se ejecutó Pacientes, o uno eliminado aquí.`,
      ) + (ids ? t(` PracticeHub patient ids:${ids}`, ` Ids de paciente en PracticeHub:${ids}`) : '')] : []),
      t('Nothing is deleted. Files already stored are skipped.', 'No se elimina nada. Los archivos ya guardados se omiten.'),
    ],
    total: queue.length,

    async apply(progress, shouldStop) {
      const services = ctx.files
      if (!services) {
        return { written: 0, errors: [t('Files are not downloaded in a preview.', 'En una vista previa no se descargan archivos.')] }
      }
      let written = 0
      let progressed = 0
      let more = false
      const errors: string[] = []
      // A file this big is copied a few MB at a time, over as many slices as
      // it takes, and never held whole: see PRACTICEHUB_LARGE_FILE_BYTES.
      const copyLarge = services.copyLarge
      const isLarge = (item: PracticeHubFileQueueItem) => !!copyLarge && (item.ph.size ?? 0) >= PRACTICEHUB_LARGE_FILE_BYTES

      const linksExpired = await eachPracticeHubDownload(queue, { concurrency: CONCURRENCY, shouldStop, progress, unbounded: isLarge }, async (item) => {
        const storagePath = practiceHubFileStoragePath(accountId, item.patientId, item.ph)
        const large = isLarge(item)
        if (large) {
          const copied = await copyLarge!({ phId: item.ph.id, url: item.ph.url!, storagePath, contentType: item.ph.mime_type ?? 'application/octet-stream' }, shouldStop)
          if (!copied.done) {
            progressed += copied.moved
            more = true
            return PRACTICEHUB_DOWNLOAD_UNFINISHED
          }
        } else {
          const fetched = await services.fetch(item.ph.url!)
          const { error: uploadError } = await supabase.storage
            .from('patient-files')
            .upload(storagePath, fetched.bytes, { contentType: item.ph.mime_type ?? fetched.contentType ?? 'application/octet-stream', upsert: true })
          if (uploadError) throw new Error(uploadError.message)
        }

        // The CSV importer may already have made a placeholder row for this
        // file (name and size known, no content). Fill that one in rather
        // than adding a second row for the same document.
        const { data: placeholder, error: lookupError } = await supabase
          .from('patient_files')
          .select('id')
          .eq('account_id', accountId)
          .eq('external_reference', String(item.ph.id))
          .maybeSingle()
        if (lookupError) throw new Error(lookupError.message)

        let fileId: string
        if (placeholder) {
          const { error } = await supabase.from('patient_files').update({ storage_path: storagePath }).eq('id', placeholder.id).eq('account_id', accountId)
          if (error) throw new Error(error.message)
          fileId = placeholder.id
        } else {
          const row: TablesInsert<'patient_files'> = {
            account_id: accountId,
            patient_id: item.patientId,
            external_reference: String(item.ph.id),
            file_name: practiceHubFileName(item.ph),
            file_type: item.ph.mime_type,
            size_bytes: item.ph.size,
            storage_path: storagePath,
            created_at: item.ph.created ?? undefined,
          }
          const { data, error } = await supabase.from('patient_files').insert(row).select('id').single()
          if (error) throw new Error(error.message)
          fileId = data.id
        }
        written++

        // Compressing reads the whole file back into memory, which is what
        // copying it in pieces was for avoiding -- and nothing this size is
        // an image it would shrink.
        if (large) return undefined

        // The same step an upload takes, so imported files do not pile up
        // for Settings › Files to compress. After the file's deadline, not
        // under it -- the file is stored by now, whatever compression does --
        // and not at all when the slice is out of time: Settings › Files
        // picks those up.
        return async () => {
          if (!shouldStop()) await withDeadline(() => Promise.resolve(services.compressFile(fileId)), COMPRESS_WAIT_MS).catch(() => {})
        }
      }, (item, e) => errors.push(`${practiceHubFileName(item.ph)}: ${practiceHubDownloadErrorText(e, t)}`))

      return { written, errors, ...(progressed ? { progressed } : {}), ...(more ? { more: true } : {}), ...(linksExpired ? { linksExpired: true } : {}) }
    },
  }
}
