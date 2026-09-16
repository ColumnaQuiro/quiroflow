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
}

type Phase = 'idle' | 'listing' | 'ready' | 'working' | 'done'
const phase = ref<Phase>('idle')
const error = ref('')

const totalInPracticeHub = ref(0)
const queue = ref<{ ph: PHFile; patientId: string }[]>([])
const alreadyHere = ref(0)
const noPatientMatch = ref(0)
const notPatientFiles = ref(0)

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

async function buildList() {
  if (!connection.value) return
  phase.value = 'listing'
  error.value = ''
  queue.value = []
  alreadyHere.value = 0
  noPatientMatch.value = 0
  notPatientFiles.value = 0
  done.value = 0
  failed.value = []

  try {
    const api = usePracticeHubApi(connection.value)

    // A file names its patient by PracticeHub's internal id; our patients
    // carry the patient NUMBER as external_reference. /patients is the only
    // place both appear together, so it is the bridge between them.
    const [phFiles, phPatients] = await Promise.all([
      api.fetchAll<PHFile>('/files'),
      api.fetchAll<PHPatient>('/patients'),
    ])
    totalInPracticeHub.value = phFiles.length

    const numberByPhId = new Map<number, string>()
    for (const p of phPatients) {
      const ref = String(p.patient_number ?? '').trim()
      if (ref) numberByPhId.set(p.id, ref)
    }

    const { data: ourPatients } = await supabase
      .from('patients')
      .select('id, external_reference')
      .eq('account_id', store.accountId!)
      .not('external_reference', 'is', null)
    const idByNumber = new Map<string, string>()
    for (const p of ourPatients ?? []) idByNumber.set(String(p.external_reference).trim(), p.id)

    // Files already carrying their bytes are skipped, which is what makes this
    // resumable -- and what lets it run again after a clinic adds more in
    // PracticeHub without re-downloading everything.
    const { data: existing } = await supabase
      .from('patient_files')
      .select('external_reference, storage_path')
      .eq('account_id', store.accountId!)
      .not('external_reference', 'is', null)
    const storedRefs = new Set(
      (existing ?? []).filter((r) => r.storage_path).map((r) => String(r.external_reference)),
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
      if (!patientId) {
        noPatientMatch.value++
        continue
      }
      if (!f.url) {
        noPatientMatch.value++
        continue
      }
      queue.value.push({ ph: f, patientId })
    }

    phase.value = 'ready'
  } catch (err: any) {
    error.value = err?.data?.statusMessage ?? err?.message ?? String(err)
    phase.value = 'idle'
  }
}

async function importOne(item: { ph: PHFile; patientId: string }) {
  const fileName = item.ph.file_name?.trim() || `practicehub-${item.ph.id}`

  // The bytes come back through our own server: PracticeHub's S3 bucket sends
  // no CORS headers for this origin, so the browser cannot read the signed URL
  // itself.
  const blob = await $fetch<Blob>('/api/import/practicehub-file', {
    method: 'POST',
    body: { url: item.ph.url },
    responseType: 'blob',
  })

  const storagePath = `${store.accountId}/${item.patientId}/${Date.now()}-${storageSafe(fileName)}`
  const { error: uploadError } = await supabase.storage
    .from('patient-files')
    .upload(storagePath, blob, { contentType: item.ph.mime_type ?? 'application/octet-stream' })
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
  const { error: insertError } = await supabase.from('patient_files').insert(row)
  if (insertError) throw new Error(insertError.message)
}

async function run() {
  phase.value = 'working'
  stopRequested.value = false

  for (let i = done.value; i < queue.value.length; i += BATCH_SIZE) {
    if (stopRequested.value) break
    const batch = queue.value.slice(i, i + BATCH_SIZE)
    // Concurrent within a batch, serial between them: the clinic's connection
    // is the limit, and a whole file list at once would swamp it.
    const results = await Promise.allSettled(batch.map((item) => importOne(item)))
    results.forEach((r, n) => {
      if (r.status === 'rejected') {
        const name = batch[n].ph.file_name ?? `#${batch[n].ph.id}`
        failed.value.push(`${name}: ${r.reason?.data?.statusMessage ?? r.reason?.message ?? r.reason}`)
      }
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
          {{ t('Reads every file from PracticeHub and stores it against the right patient here.', 'Lee todos los archivos de PracticeHub y los guarda en el paciente correspondiente aquí.') }}
        </p>
        <p class="mt-1 text-[12.5px] text-ink-muted2">
          {{ t('Safe to run more than once — anything already stored is skipped.', 'Se puede ejecutar varias veces: se omite lo que ya esté guardado.') }}
        </p>
        <UiBtn class="mt-3" variant="primary" @click="buildList">{{ t('Check PracticeHub', 'Comprobar PracticeHub') }}</UiBtn>
      </div>

      <div v-else-if="phase === 'listing'" class="rounded-card border border-line bg-surface p-8 text-center text-[13px] text-ink-muted2">
        {{ t('Reading the file list from PracticeHub…', 'Leyendo la lista de archivos de PracticeHub…') }}
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
              <dd class="mt-0.5 font-mono text-[15px] text-ink-900">{{ queue.length }}</dd>
            </div>
            <div>
              <dt class="text-ink-faint">{{ t('Already here', 'Ya están') }}</dt>
              <dd class="mt-0.5 font-mono text-[15px] text-ink-700">{{ alreadyHere }}</dd>
            </div>
            <div>
              <dt class="text-ink-faint">{{ t('No patient match', 'Sin paciente') }}</dt>
              <dd class="mt-0.5 font-mono text-[15px]" :class="noPatientMatch > 0 ? 'text-warning-text' : 'text-ink-700'">{{ noPatientMatch }}</dd>
            </div>
          </dl>
          <p v-if="notPatientFiles > 0" class="mt-2 text-[12px] text-ink-faint">
            {{ t(`${notPatientFiles} file(s) in PracticeHub are not attached to a patient and are left alone.`, `${notPatientFiles} archivo(s) de PracticeHub no están asociados a un paciente y se dejan como están.`) }}
          </p>
          <p v-if="noPatientMatch > 0" class="mt-1 text-[12px] text-warning-text">
            {{ t('Files with no patient match belong to patients that have not been imported yet — run the Patients import first, then come back.', 'Los archivos sin paciente pertenecen a pacientes que aún no se han importado: ejecuta primero la importación de Pacientes y vuelve aquí.') }}
          </p>
        </div>

        <div v-if="phase === 'working' || done > 0" class="rounded-card border border-line bg-surface p-4">
          <div class="flex items-baseline justify-between">
            <p class="text-[13px] font-medium text-ink-700">{{ done }} / {{ queue.length }}</p>
            <p class="text-[12.5px] text-ink-muted2">{{ progressPct }}%</p>
          </div>
          <div class="mt-2 h-2 overflow-hidden rounded-full bg-line">
            <div class="h-full rounded-full bg-brand transition-all" :style="{ width: `${progressPct}%` }" />
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <UiBtn v-if="phase === 'ready' && queue.length > 0" variant="primary" @click="run">
            {{ done > 0 ? t('Continue', 'Continuar') : t('Bring the files over', 'Traer los archivos') }}
          </UiBtn>
          <UiBtn v-if="phase === 'working'" variant="secondary" @click="stopRequested = true">
            {{ t('Stop after this batch', 'Parar tras este lote') }}
          </UiBtn>
          <UiBtn v-if="phase !== 'working'" variant="secondary" @click="buildList">{{ t('Re-check', 'Volver a comprobar') }}</UiBtn>
        </div>

        <div v-if="phase === 'done'" class="rounded-ctl border border-line bg-surface-subtle p-3 text-[12.5px] text-ink-muted2">
          {{ t('Finished. Run it again any time — files already stored are skipped.', 'Terminado. Puedes ejecutarlo cuando quieras: se omiten los archivos ya guardados.') }}
        </div>

        <div v-if="failed.length > 0" class="rounded-ctl border border-danger-border bg-danger-bg p-3 text-[12.5px] text-danger-text">
          <p class="font-medium">{{ t(`${failed.length} file(s) failed:`, `${failed.length} archivo(s) fallaron:`) }}</p>
          <ul class="mt-1 max-h-40 list-disc overflow-y-auto pl-5">
            <li v-for="(f, i) in failed" :key="i">{{ f }}</li>
          </ul>
          <p class="mt-1">{{ t('Re-check and continue to retry them.', 'Vuelve a comprobar y continúa para reintentarlos.') }}</p>
        </div>
      </div>
    </template>

    <p v-if="error" class="mt-3 text-[12.5px] text-danger-text">{{ error }}</p>
  </div>
</template>
