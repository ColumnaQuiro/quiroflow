<script setup lang="ts">
// Brings patient files across from PracticeHub over its API.
//
// This replaces a CSV export plus a local Playwright script that drove a real
// Chromium through the clinic's own PracticeHub session, clicking "View" on
// each file because "PracticeHub has no bulk file-download API". It does have
// one: GET /api/files returns every attachment with its patient, mime type,
// size and a pre-signed S3 URL. The script's founding assumption was wrong,
// and everything it did existed to work around a problem that was not there.
//
// What that cost, measured from its own logs: 13 seconds a patient, 21
// failures in 135 -- nearly all timeouts on the patient-search table, because
// it identified patients by typing a surname and clicking through same-name
// matches comparing phone numbers. Here the file record names its patient
// outright.
//
// Work happens in batches from the browser, with the count on screen, because
// a clinic can have thousands of files and one request cannot hold them. It is
// resumable by construction: a file already carrying a storage_path is skipped,
// so closing the tab and coming back loses only the batch in flight.
import type { TablesInsert } from '~/types/database.types'
import { forgetPracticeHubReads } from '~/utils/practicehubReadCache'
import { planProfilePhotos, practiceHubPhotoPath, sniffImageType } from '~/utils/practicehubProfilePhotos'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const connection = usePracticeHubConnection()

// Small enough that a stall is visible and a stop is quick, large enough that
// the per-request overhead does not dominate.
const BATCH_SIZE = 20

interface PHFile {
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
interface PHPatient {
  id: number
  patient_number: string | number | null
  // The patient's profile photo, as a signed link like a file's. See
  // utils/practicehubProfilePhotos.ts.
  profile_image?: string | null
}

// One thing to fetch: an attached file, or a patient's profile photo. They
// share the queue, the batches and the progress bar because they are the same
// work -- signed S3 bytes fetched through our server -- and a clinic should
// not have to run two steps to arrive with what it had.
type QueueItem =
  | { kind: 'file'; ph: PHFile; patientId: string }
  | { kind: 'photo'; phPatientId: number; patientId: string; url: string }

type Phase = 'idle' | 'listing' | 'ready' | 'working' | 'done'
const phase = ref<Phase>('idle')
useImportWriting(() => phase.value === 'working')
const error = ref('')

const totalInPracticeHub = ref(0)
const queue = ref<QueueItem[]>([])
const filesQueued = computed(() => queue.value.filter((item) => item.kind === 'file').length)
const photosQueued = computed(() => queue.value.filter((item) => item.kind === 'photo').length)
// Patients whose PracticeHub photo is not needed: they already have one here.
const photosAlreadyHere = ref(0)
// "Photos" that turned out to be something else (a PDF uploaded as the
// profile picture). Counted apart from failures: retrying changes nothing.
const photosNotImages = ref(0)
const alreadyHere = ref(0)
// Three different reasons, counted separately. They were one bucket called
// "No patient match", which then reported 688 of 2,624 and told the clinic to
// run the Patients import -- advice that was wrong, and unfalsifiable from the
// screen: a file with no download URL landed in the same number as a file
// whose patient was genuinely absent.
const noPatientMatch = ref(0)
// Files whose patient PracticeHub no longer lists at all. Its /patients
// endpoint leaves deleted patients out while their files stay behind, so the
// Patients import never saw them and running it again changes nothing -- the
// same distinction PracticeHubReconciliation draws for invoices. These were
// counted as "Patient not here", with advice to re-import, on a clinic where
// every patient PracticeHub still has was already here.
const patientDeletedInPh = ref(0)
const noDownloadUrl = ref(0)
const notPatientFiles = ref(0)
// Which PracticeHub patients could not be found, so the clinic can go and look
// at one instead of taking the number on faith. Capped -- this is a hint, not
// a report.
const unmatchedPhPatients = ref<number[]>([])

// What the listing phase is reading, with fetchAll's own count. A clinic with
// thousands of files spends a minute or more here at 100 rows a page, and a
// bare "Reading…" gave no way to tell slow from stuck.
const listingStep = ref<'files' | 'patients' | 'here'>('files')
const listingProgress = ref({ done: 0, total: 0 })
const listingPct = computed(() =>
  listingProgress.value.total === 0 ? 0 : Math.min(100, Math.round((listingProgress.value.done / listingProgress.value.total) * 100)),
)

const done = ref(0)
const failed = ref<string[]>([])
const stopRequested = ref(false)

const progressPct = computed(() => (queue.value.length === 0 ? 0 : Math.round((done.value / queue.value.length) * 100)))

// Supabase Storage rejects object keys with certain non-ASCII characters
// outright ("Invalid key"), and PracticeHub filenames are full of them --
// accented Spanish and enye. Same rule as utils/storageFilename.ts.
const ACCENTS: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U', Ñ: 'N',
}
function storageSafe(name: string): string {
  return name.replace(/[áéíóúüñÁÉÍÓÚÜÑ]/g, (c) => ACCENTS[c] ?? c).replace(/[^a-zA-Z0-9._-]/g, '_')
}

// PostgREST returns at most max_rows per request -- 1,000 for this project
// (supabase/config.toml) -- and does it SILENTLY: a truncated answer looks
// exactly like a complete one, no error, no flag.
//
// That is what made 688 files report "Patient not here". There are 1,530
// patients carrying a PracticeHub reference, so the map was built from the
// first 1,000 of them and every file belonging to the other 530 failed to
// match. The ids on screen were 3, 5, 11, 14 -- PracticeHub's OLDEST
// patients, which is what finally gave it away: a truncated read, not missing
// data, because the rows come back in no order anyone chose.
//
// The same cap silently truncated the already-stored set, from 2,635 rows to
// 1,000. That one had not bitten yet only because the queue it feeds was
// truncated too; left alone it would have re-downloaded and re-uploaded
// roughly 1,500 files the clinic already had, orphaning their storage objects
// on the way past.
const PAGE_SIZE = 1000
async function readAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await run(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    rows.push(...page)
    // A short page is the last one. Asking again after an exactly-full page
    // costs one request and is the only way to know it was the end.
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

async function buildList() {
  if (!connection.value) return
  phase.value = 'listing'
  error.value = ''
  queue.value = []
  alreadyHere.value = 0
  noPatientMatch.value = 0
  patientDeletedInPh.value = 0
  noDownloadUrl.value = 0
  notPatientFiles.value = 0
  photosAlreadyHere.value = 0
  photosNotImages.value = 0
  unmatchedPhPatients.value = []
  done.value = 0
  failed.value = []

  try {
    const api = usePracticeHubApi(connection.value)

    // A file names its patient by PracticeHub's internal id; our patients
    // carry the patient NUMBER as external_reference. /patients is the only
    // place both appear together, so it is the bridge between them.
    // Sequential, not Promise.all. PracticeHub rate-limits: two of these at
    // once answers 429, and while fetchPage retries, starting a long migration
    // by tripping their limiter is a poor way to begin.
    const onProgress = (fetched: number, total: number) => (listingProgress.value = { done: fetched, total })
    listingStep.value = 'files'
    listingProgress.value = { done: 0, total: 0 }
    const phFiles = await api.fetchAll<PHFile>('/files', onProgress)
    listingStep.value = 'patients'
    listingProgress.value = { done: 0, total: 0 }
    const phPatients = await api.fetchAll<PHPatient>('/patients', onProgress)
    totalInPracticeHub.value = phFiles.length
    listingStep.value = 'here'

    const phPatientIds = new Set(phPatients.map((p) => p.id))
    const numberByPhId = new Map<number, string>()
    for (const p of phPatients) {
      const ref = String(p.patient_number ?? '').trim()
      if (ref) numberByPhId.set(p.id, ref)
    }

    const ourPatients = await readAll<{ id: string; external_reference: string; photo_storage_path: string | null }>((from, to) =>
      supabase
        .from('patients')
        .select('id, external_reference, photo_storage_path')
        .eq('account_id', store.accountId!)
        .not('external_reference', 'is', null)
        .order('id').range(from, to),
    )
    const idByNumber = new Map<string, string>()
    for (const p of ourPatients) idByNumber.set(String(p.external_reference).trim(), p.id)

    // Files already carrying their bytes are skipped, which is what makes this
    // resumable -- and what lets it run again after a clinic adds more in
    // PracticeHub without re-downloading everything.
    const existing = await readAll<{ external_reference: string; storage_path: string | null }>((from, to) =>
      supabase
        .from('patient_files')
        .select('external_reference, storage_path')
        .eq('account_id', store.accountId!)
        .not('external_reference', 'is', null)
        .order('id').range(from, to),
    )
    const storedRefs = new Set(
      existing.filter((r) => r.storage_path).map((r) => String(r.external_reference)),
    )

    for (const f of phFiles) {
      // PracticeHub attaches files to things other than patients; only a
      // patient's belong on a patient record here.
      if (f.entity_type && f.entity_type !== 'patient') {
        notPatientFiles.value++
        continue
      }
      if (storedRefs.has(String(f.id))) {
        alreadyHere.value++
        continue
      }
      const number = f.patient_id === null ? null : numberByPhId.get(f.patient_id)
      const patientId = number ? idByNumber.get(number) : undefined
      if (!patientId && f.patient_id !== null && !phPatientIds.has(f.patient_id)) {
        patientDeletedInPh.value++
        continue
      }
      if (!patientId) {
        noPatientMatch.value++
        if (f.patient_id !== null && unmatchedPhPatients.value.length < 12 && !unmatchedPhPatients.value.includes(f.patient_id)) {
          unmatchedPhPatients.value.push(f.patient_id)
        }
        continue
      }
      // Nothing to do with the patient: PracticeHub gave us no link to fetch.
      if (!f.url) {
        noDownloadUrl.value++
        continue
      }
      queue.value.push({ kind: 'file', ph: f, patientId })
    }

    // Photos go first: there are few of them, they are small, and their links
    // were signed with the patient list, so they should not sit behind hours
    // of x-rays waiting to expire.
    const photos = planProfilePhotos(phPatients, ourPatients)
    photosAlreadyHere.value = photos.alreadyHere
    queue.value.unshift(...photos.queue.map((photo) => ({ kind: 'photo' as const, ...photo })))

    phase.value = 'ready'
  } catch (err: any) {
    error.value = t(
      `Could not read the file list from PracticeHub. Nothing was written; Check PracticeHub again to retry. (${err?.data?.statusMessage ?? err?.message ?? String(err)})`,
      `No se pudo leer la lista de archivos de PracticeHub. No se escribió nada; pulsa de nuevo Comprobar PracticeHub para reintentar. (${err?.data?.statusMessage ?? err?.message ?? String(err)})`,
    )
    phase.value = 'idle'
  }
}

// Stores a patient's PracticeHub photo as their photo here.
async function importPhoto(item: Extract<QueueItem, { kind: 'photo' }>) {
  const blob = await $fetch<Blob>('/api/import/practicehub-file', {
    method: 'POST',
    body: { url: item.url },
    responseType: 'blob',
  })
  const image = sniffImageType(new Uint8Array(await blob.slice(0, 16).arrayBuffer()))
  if (!image) {
    photosNotImages.value++
    return
  }

  const path = practiceHubPhotoPath(store.accountId!, item.patientId, image.extension)
  const { error: uploadError } = await supabase.storage
    .from('patient-photos')
    .upload(path, blob, { contentType: image.contentType, upsert: true })
  if (uploadError) throw new Error(uploadError.message)

  // Only onto a patient who still has none. The list was read a while ago,
  // and a photo taken at the desk since then is the one to keep.
  const { error: updateError } = await supabase
    .from('patients')
    .update({ photo_storage_path: path })
    .eq('id', item.patientId)
    .is('photo_storage_path', null)
  if (updateError) throw new Error(updateError.message)
}

async function importOne(item: QueueItem) {
  if (item.kind === 'photo') return importPhoto(item)
  const fileName = item.ph.file_name?.trim() || `practicehub-${item.ph.id}`

  // The bytes come back through our own server: PracticeHub's S3 bucket sends
  // no CORS headers for this origin, so the browser cannot read the signed URL
  // itself.
  const blob = await $fetch<Blob>('/api/import/practicehub-file', {
    method: 'POST',
    body: { url: item.ph.url },
    responseType: 'blob',
  })

  // Keyed on PracticeHub's file id, not the clock. Date.now() alone collides
  // when one patient has two files of the same name uploaded in the same
  // millisecond -- which a batch of 20 makes reachable, and a patient with
  // several IMG_0001.jpg makes likely. upload() refuses an existing key, so it
  // would surface as a failed file rather than a lost one, but the id is
  // already unique per file and costs nothing.
  const storagePath = `${store.accountId}/${item.patientId}/${item.ph.id}-${storageSafe(fileName)}`
  const { error: uploadError } = await supabase.storage
    .from('patient-files')
    .upload(storagePath, blob, {
      contentType: item.ph.mime_type ?? 'application/octet-stream',
      // Paired with the deterministic path above: a retry writes the same
      // object again instead of being refused for existing. Together they make
      // re-running free of both duplicates and orphans -- the clock-based path
      // took a fresh key every attempt, so a file fetched twice left its first
      // upload behind with nothing pointing at it.
      upsert: true,
    })
  if (uploadError) throw new Error(uploadError.message)

  // The CSV importer may already have made a placeholder row for this file
  // (name and size known, no content). Fill that one in rather than adding a
  // second row for the same document.
  const { data: placeholder } = await supabase
    .from('patient_files')
    .select('id')
    .eq('account_id', store.accountId!)
    .eq('external_reference', String(item.ph.id))
    .maybeSingle()

  if (placeholder) {
    const { error: updateError } = await supabase
      .from('patient_files')
      .update({ storage_path: storagePath })
      .eq('id', placeholder.id)
    if (updateError) throw new Error(updateError.message)
    await compress(placeholder.id)
    return
  }

  const row: TablesInsert<'patient_files'> = {
    account_id: store.accountId!,
    patient_id: item.patientId,
    external_reference: String(item.ph.id),
    file_name: fileName,
    file_type: item.ph.mime_type,
    size_bytes: item.ph.size,
    storage_path: storagePath,
    created_at: item.ph.created ?? undefined,
  }
  const { data: inserted, error: insertError } = await supabase.from('patient_files').insert(row).select('id').single()
  if (insertError) throw new Error(insertError.message)
  await compress(inserted.id)
}

// The same step an upload takes (components/patients/FilesTab.vue). Imported
// files skipped it, and by Sep 2026 made up 2,521 of the 2,597 files that
// Settings > Files still had to compress. Awaited, unlike on upload, so a
// batch never has more than BATCH_SIZE compressions running at once; a file
// that fails to compress is still imported, and Settings > Files picks it up.
async function compress(fileId: string) {
  await useStaffFetch('/api/patients/files/compress', { method: 'POST', body: { fileId } }).catch(() => {})
}

// The download links PracticeHub hands out are pre-signed and short-lived, and
// they are all signed at the moment the list is read. A clinic with thousands
// of files outlasts them: at one clinic every file after a point failed with
// 410 -- 3,937 of them -- because the run was still going when the links it
// had read at the start ran out. Nothing was wrong with those files; their
// links were simply old.
//
// So a 410 re-reads the list for fresh links and the files that hit it are
// tried once more. Every link in the queue is replaced, not only the failed
// ones, because they were all signed together and expire together.
function isExpiredLink(reason: any): boolean {
  return (reason?.statusCode ?? reason?.response?.status) === 410
}
const refreshingLinks = ref(false)
async function refreshLinks() {
  if (!connection.value) return
  refreshingLinks.value = true
  try {
    const api = usePracticeHubApi(connection.value)
    const phFiles = await api.fetchAll<PHFile>('/files')
    const urlById = new Map(phFiles.map((f) => [f.id, f.url]))
    // A photo's link comes from the patient list, which is held between steps
    // -- and a held copy would hand the expired links straight back.
    const photoUrlById = new Map<number, string>()
    if (queue.value.slice(done.value).some((item) => item.kind === 'photo')) {
      forgetPracticeHubReads()
      for (const p of await api.fetchAll<PHPatient>('/patients')) if (p.profile_image) photoUrlById.set(p.id, p.profile_image)
    }
    for (const item of queue.value) {
      if (item.kind === 'photo') {
        item.url = photoUrlById.get(item.phPatientId) ?? item.url
        continue
      }
      const url = urlById.get(item.ph.id)
      if (url) item.ph.url = url
    }
  } finally {
    refreshingLinks.value = false
  }
}

function failureText(item: QueueItem, reason: any): string {
  const name =
    item.kind === 'photo'
      ? t(`Photo of PracticeHub patient ${item.phPatientId}`, `Foto del paciente ${item.phPatientId} de PracticeHub`)
      : (item.ph.file_name ?? `#${item.ph.id}`)
  // responseType 'blob' leaves an error's body as a Blob, so the server's
  // statusMessage never reaches data; the status on the error does.
  const status = reason?.statusCode ?? reason?.response?.status
  const message = reason?.data?.statusMessage ?? reason?.statusMessage ?? reason?.message ?? String(reason)
  return status && !String(message).includes(String(status)) ? `${name}: ${message} (${status})` : `${name}: ${message}`
}

async function run() {
  phase.value = 'working'
  stopRequested.value = false
  error.value = ''

  for (let i = done.value; i < queue.value.length; i += BATCH_SIZE) {
    if (stopRequested.value) break
    const batch = queue.value.slice(i, i + BATCH_SIZE)
    // Concurrent within a batch, serial between them: the clinic's connection
    // is the limit, and a whole file list at once would swamp it.
    let results = await Promise.allSettled(batch.map((item) => importOne(item)))

    if (results.some((r) => r.status === 'rejected' && isExpiredLink(r.reason))) {
      try {
        await refreshLinks()
        results = await Promise.all(
          results.map((r, n) =>
            r.status === 'rejected' && isExpiredLink(r.reason)
              ? importOne(batch[n]).then(
                  (value): PromiseSettledResult<void> => ({ status: 'fulfilled', value }),
                  (reason): PromiseSettledResult<void> => ({ status: 'rejected', reason }),
                )
              : r,
          ),
        )
      } catch (err: any) {
        // Could not re-read the list: stop here rather than burn through the
        // rest of the queue on links that are known to be dead. Continue picks
        // up from this batch.
        error.value = t(
          `The download links expired and PracticeHub could not be read again for new ones: ${err?.data?.statusMessage ?? err?.message ?? err}. Continue to retry.`,
          `Los enlaces de descarga caducaron y no se pudo volver a leer PracticeHub para obtener otros: ${err?.data?.statusMessage ?? err?.message ?? err}. Pulsa Continuar para reintentar.`,
        )
        phase.value = 'ready'
        return
      }
    }

    results.forEach((r, n) => {
      if (r.status === 'rejected') failed.value.push(failureText(batch[n], r.reason))
    })
    done.value = Math.min(i + BATCH_SIZE, queue.value.length)
  }

  phase.value = stopRequested.value ? 'ready' : 'done'
}
</script>

<template>
  <div>
    <ImportPracticeHubConnectForm v-if="!connection" @connect="connection = $event" />

    <template v-else>
      <div v-if="phase === 'idle'" class="rounded-card border border-line bg-surface p-4">
        <p class="text-[13px] text-ink-700">
          {{ t('Reads every file and profile photo from PracticeHub and stores it against the right patient here.', 'Lee todos los archivos y fotos de perfil de PracticeHub y los guarda en el paciente correspondiente aquí.') }}
        </p>
        <p class="mt-1 text-[12.5px] text-ink-muted2">
          {{ t('Safe to run more than once: anything already stored is skipped.', 'Se puede ejecutar varias veces: se omite lo que ya esté guardado.') }}
        </p>
        <UiBtn class="mt-3" variant="primary" @click="buildList">{{ t('Check PracticeHub', 'Comprobar PracticeHub') }}</UiBtn>
      </div>

      <div v-else-if="phase === 'listing'" class="rounded-card border border-line bg-surface p-8 text-center text-[13px] text-ink-muted2">
        <p v-if="listingStep === 'files'">{{ t('Reading the file list from PracticeHub…', 'Leyendo la lista de archivos de PracticeHub…') }}</p>
        <p v-else-if="listingStep === 'patients'">{{ t('Reading the patient list from PracticeHub…', 'Leyendo la lista de pacientes de PracticeHub…') }}</p>
        <p v-else>{{ t('Comparing with what is already here…', 'Comparando con lo que ya hay aquí…') }}</p>
        <template v-if="listingStep !== 'here' && listingProgress.total > 0">
          <p class="mt-2 font-mono text-[12.5px] text-ink-700">{{ listingProgress.done }} / {{ listingProgress.total }}</p>
          <div class="mx-auto mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-line">
            <div class="h-full rounded-full bg-brand transition-all" :style="{ width: `${listingPct}%` }" />
          </div>
        </template>
      </div>

      <div v-else class="space-y-4">
        <div class="rounded-card border border-line bg-surface p-4">
          <dl class="grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-4">
            <div>
              <dt class="text-ink-faint">{{ t('In PracticeHub', 'En PracticeHub') }}</dt>
              <dd class="mt-0.5 font-mono text-[15px] text-ink-900">{{ totalInPracticeHub }}</dd>
            </div>
            <div>
              <dt class="text-ink-faint">{{ t('To bring over', 'Por traer') }}</dt>
              <dd class="mt-0.5 font-mono text-[15px] text-ink-900" data-cy="ph-files-queued">{{ filesQueued }}</dd>
            </div>
            <div>
              <dt class="text-ink-faint">{{ t('Already here', 'Ya están') }}</dt>
              <dd class="mt-0.5 font-mono text-[15px] text-ink-700">{{ alreadyHere }}</dd>
            </div>
            <div>
              <dt class="text-ink-faint">{{ t('No patient here', 'Sin paciente aquí') }}</dt>
              <dd class="mt-0.5 font-mono text-[15px]" :class="noPatientMatch > 0 ? 'text-warning-text' : 'text-ink-700'">{{ noPatientMatch }}</dd>
            </div>
          </dl>
          <p v-if="photosQueued > 0 || photosAlreadyHere > 0" class="mt-2 text-[12px] text-ink-700" data-cy="ph-photos-summary">
            {{ t(`Profile photos: ${photosQueued} to bring over, ${photosAlreadyHere} already here.`, `Fotos de perfil: ${photosQueued} por traer, ${photosAlreadyHere} ya están aquí.`) }}
          </p>
          <p v-if="photosNotImages > 0" class="mt-1 text-[12px] text-ink-faint">
            {{ t(`Profile photos left out because PracticeHub holds a PDF or other document there, not a picture: ${photosNotImages}.`, `Fotos de perfil que no se han traído porque en PracticeHub hay un PDF u otro documento, no una imagen: ${photosNotImages}.`) }}
          </p>
          <p v-if="notPatientFiles > 0" class="mt-2 text-[12px] text-ink-faint">
            {{ t(`${notPatientFiles} ${notPatientFiles === 1 ? 'file' : 'files'} in PracticeHub belong to something other than a patient (reports and data exports) and are left alone.`, `${notPatientFiles} ${notPatientFiles === 1 ? 'archivo' : 'archivos'} de PracticeHub no son de un paciente (informes y exportaciones) y se dejan como están.`) }}
          </p>
          <p v-if="patientDeletedInPh > 0" class="mt-1 text-[12px] text-ink-faint">
            {{ t(`${patientDeletedInPh} ${patientDeletedInPh === 1 ? 'file belongs' : 'files belong'} to patients deleted in PracticeHub, so there is no patient to attach them to. They are left alone.`, `${patientDeletedInPh} ${patientDeletedInPh === 1 ? 'archivo es' : 'archivos son'} de pacientes eliminados en PracticeHub, así que no hay paciente al que asociarlos. Se dejan como están.`) }}
          </p>
          <p v-if="noDownloadUrl > 0" class="mt-1 text-[12px] text-warning-text">
            {{ t(`${noDownloadUrl} ${noDownloadUrl === 1 ? 'file has' : 'files have'} a patient here but no download link from PracticeHub, so there is nothing to fetch.`, `${noDownloadUrl} ${noDownloadUrl === 1 ? 'archivo tiene' : 'archivos tienen'} paciente aquí pero PracticeHub no dio enlace de descarga, así que no hay nada que traer.`) }}
          </p>
          <!--
            Says what was not found instead of asserting why. The first version
            claimed these belonged to patients "not imported yet" and told the
            clinic to run the Patients import -- on an account where 1,530 of
            PracticeHub's 1,535 patients were already here, so the advice was
            wrong and the screen gave no way to tell.
          -->
          <div v-if="noPatientMatch > 0" class="mt-1 text-[12px] text-warning-text">
            <p>
              {{ t(`${noPatientMatch} ${noPatientMatch === 1 ? 'file names' : 'files name'} a PracticeHub patient who is not in QuiroFlow.`, `${noPatientMatch} ${noPatientMatch === 1 ? 'archivo indica' : 'archivos indican'} un paciente de PracticeHub que no está en QuiroFlow.`) }}
            </p>
            <p class="mt-0.5 text-ink-muted2">
              {{ t('Usually a patient added to PracticeHub since Patients last ran, or one deleted here. Run Patients and check again; anything still listed is worth opening in PracticeHub.', 'Normalmente es un paciente añadido en PracticeHub desde la última vez que se ejecutó Pacientes, o uno eliminado aquí. Ejecuta Pacientes y vuelve a comprobar; lo que siga apareciendo conviene abrirlo en PracticeHub.') }}
            </p>
            <p v-if="unmatchedPhPatients.length > 0" class="mt-0.5 font-mono text-[11.5px] text-ink-muted2">
              {{ t('PracticeHub patient ids:', 'Ids de paciente en PracticeHub:') }}
              {{ unmatchedPhPatients.join(', ') }}{{ noPatientMatch > unmatchedPhPatients.length ? '…' : '' }}
            </p>
          </div>
        </div>

        <div v-if="phase === 'working' || done > 0" class="rounded-card border border-line bg-surface p-4">
          <div class="flex items-baseline justify-between">
            <p class="text-[13px] font-medium text-ink-700">{{ done }} / {{ queue.length }}</p>
            <p class="text-[12.5px] text-ink-muted2">{{ progressPct }}%</p>
          </div>
          <div class="mt-2 h-2 overflow-hidden rounded-full bg-line">
            <div class="h-full rounded-full bg-brand transition-all" :style="{ width: `${progressPct}%` }" />
          </div>
          <p v-if="refreshingLinks" class="mt-2 text-[12.5px] text-ink-muted2">
            {{ t('The download links expired. Getting new ones from PracticeHub…', 'Los enlaces de descarga caducaron. Pidiendo otros nuevos a PracticeHub…') }}
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <UiBtn v-if="phase === 'ready' && queue.length > 0" variant="primary" @click="run">
            {{ done > 0 ? t('Continue', 'Continuar') : filesQueued === 0 ? t('Bring the photos over', 'Traer las fotos') : photosQueued === 0 ? t('Bring the files over', 'Traer los archivos') : t('Bring the files and photos over', 'Traer los archivos y las fotos') }}
          </UiBtn>
          <UiBtn v-if="phase === 'working'" variant="secondary" @click="stopRequested = true">
            {{ t('Stop after this batch', 'Parar tras este lote') }}
          </UiBtn>
          <UiBtn v-if="phase !== 'working'" variant="secondary" @click="buildList">{{ t('Check again', 'Volver a comprobar') }}</UiBtn>
        </div>

        <div v-if="phase === 'done'" class="rounded-ctl border border-line bg-surface-subtle p-3 text-[12.5px] text-ink-muted2">
          {{ t('Finished. Run it again any time: files and photos already stored are skipped.', 'Terminado. Puedes ejecutarlo cuando quieras: se omiten los archivos y fotos ya guardados.') }}
        </div>

        <div v-if="failed.length > 0" class="rounded-ctl border border-danger-border bg-danger-bg p-3 text-[12.5px] text-danger-text">
          <p class="font-medium">{{ t(`${failed.length} ${failed.length === 1 ? 'file was' : 'files were'} not copied:`, `${failed.length} ${failed.length === 1 ? 'archivo no se copió' : 'archivos no se copiaron'}:`) }}</p>
          <ul class="mt-1 max-h-40 list-disc overflow-y-auto pl-5">
            <li v-for="(f, i) in failed" :key="i">{{ f }}</li>
          </ul>
          <p class="mt-1">{{ t('Check again, then continue, to retry them.', 'Vuelve a comprobar y continúa para reintentarlos.') }}</p>
        </div>
      </div>
    </template>

    <p v-if="error" class="mt-3 text-[12.5px] text-danger-text">{{ error }}</p>
  </div>
</template>
