<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import Papa from 'papaparse'
import { shrinkImageForUpload } from '~/utils/imageShrink'
import { planProfilePhotos, practiceHubPhotoPath, sniffImageType, type PracticeHubPhotoSource } from '~/utils/practicehubProfilePhotos'
import { practiceHubGovernmentNumbers, practiceHubPatientNumberMap, practiceHubPatientRows, type PHApiPatient, type PHNamed, type PHV3Patient } from '~/utils/practicehubApiRows'
import {
  practiceHubBlank,
  practiceHubLanguageLabel,
  practiceHubNumberCountries,
  practiceHubNumberCountryKey,
  practiceHubOnlyNewNumbers,
  practiceHubPatientFieldLabel,
  practiceHubPatientsDiff,
  practiceHubPractitionerMatcher,
  practiceHubShownValue,
  PRACTICEHUB_EXISTING_PATIENT_COLUMNS,
  type PracticeHubContactNumber,
  type PracticeHubExistingPatient,
  type PracticeHubPatientToCreate,
  type PracticeHubPatientToUpdate,
} from '~/utils/practicehubImport/patients'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

// The CSV export carries "Mobile" and "Home" as bare strings with no
// country; PracticeHub's /patients API gives each number's. Why that matters
// is at practiceHubNumberCountries (utils/practicehubImport/patients.ts).
const connection = usePracticeHubConnection()
const numberCountries = ref(new Map<string, string>())
const countryLookupState = ref<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
// The CSV's "Patient Number" holds a custom reference (DNI, passport) for
// the patients who have one, and every later step matches on the real
// patient number -- so their payments and bonos never arrived. The API knows
// which is which; a CSV row is stored under the number it maps to.
const patientNumberFor = ref(new Map<string, string>())

// Each patient's profile photo, as PracticeHub's patient list links to it.
// Read with the same list as the phone countries, so it is there whether the
// patients came from the API or from a CSV with the connection saved. The
// photos are fetched after the patients are written: see bringPhotos.
const photoSources = ref<PracticeHubPhotoSource[]>([])
// How many of those photos this run will fetch: every one whose patient has
// no photo here yet, including the patients it is about to create.
const photosToBring = ref(0)
const photoProgress = ref<{ done: number; total: number } | null>(null)
const photosImported = ref(0)
const photosNotImages = ref(0)

function readNumberCountries(patients: PHApiPatient[]) {
  numberCountries.value = practiceHubNumberCountries(patients)
  patientNumberFor.value = practiceHubPatientNumberMap(patients)
  photoSources.value = patients.filter((p) => p.profile_image).map((p) => ({ id: p.id, patient_number: p.patient_number, profile_image: p.profile_image }))
  countryLookupState.value = 'ready'
}

async function loadNumberCountries() {
  if (!connection.value) {
    countryLookupState.value = 'unavailable'
    return
  }
  countryLookupState.value = 'loading'
  try {
    const api = usePracticeHubApi(connection.value)
    readNumberCountries(await api.fetchAll<PHApiPatient>('/patients'))
  } catch {
    // A failed lookup imports the numbers rather than the whole file --
    // every other field is in the CSV and is still worth having.
    countryLookupState.value = 'unavailable'
  }
}

// Reads the patients straight from PracticeHub's API instead of a CSV
// export: the same rows, built by utils/practicehubApiRows.ts, through the
// same preview. Tags are only in PracticeHub 2.0's API, so they come across
// when that key is saved too, and the preview says so when it is not.
const loadingFromApi = ref(false)
const apiProgress = ref('')
const tagsUnavailable = ref(false)

// What only PracticeHub 2.0's /patients carries: each patient's tags, and the
// "Social security number" a Spanish clinic keeps the DNI/NIE in.
async function loadFromV3(): Promise<{ tagsByPatientNumber: Map<string, string[]>; governmentNumberById: Map<string, string> } | undefined> {
  const saved = await useStaffFetch<{ hasV3Key?: boolean }>('/api/import/practicehub-connection').catch(() => null)
  if (!saved?.hasV3Key) return undefined
  try {
    const patients = await usePracticeHubV3().fetchAll<PHV3Patient>('/patients')
    return {
      tagsByPatientNumber: new Map(patients.map((p) => [String(p.patient_number ?? '').trim(), (p.tags ?? []).map((tag) => tag.name).filter(Boolean)])),
      governmentNumberById: practiceHubGovernmentNumbers(patients),
    }
  } catch {
    return undefined
  }
}

async function loadFromPracticeHub() {
  if (!connection.value) return
  fileError.value = ''
  loadingFromApi.value = true
  try {
    const api = usePracticeHubApi(connection.value)
    apiProgress.value = t('Reading practitioners and referral sources…', 'Leyendo profesionales y fuentes de referencia…')
    const practitioners = await api.fetchAll<PHNamed>('/practitioners')
    const referralSources = await api.fetchAll<PHNamed>('/referral_sources')
    const patients = await api.fetchAll<PHApiPatient>('/patients', (fetched, total) => {
      apiProgress.value = t(`Reading patients… ${fetched} / ${total}`, `Leyendo pacientes… ${fetched} / ${total}`)
    })
    apiProgress.value = t('Reading tags…', 'Leyendo etiquetas…')
    const fromV3 = await loadFromV3()
    tagsUnavailable.value = !fromV3

    readNumberCountries(patients)
    rawRows.value = practiceHubPatientRows(patients, { practitioners, referralSources, ...fromV3 })
    fileName.value = t('PracticeHub, read just now', 'PracticeHub, leído ahora mismo')
    await computeDiff()
    stage.value = 'preview'
  } catch (e: any) {
    fileError.value = importErrorText(e, t, { en: 'Could not read PracticeHub. Nothing was written; try again.', es: 'No se pudo leer PracticeHub. No se escribió nada; vuelve a intentarlo.' })
  } finally {
    loadingFromApi.value = false
    apiProgress.value = ''
  }
}

// The fallback for a number PracticeHub's API didn't answer for. The
// account's own country, not Spain's -- a clinic in Lisbon importing without
// a connection should get Portuguese numbers, not the bug this replaced.
const defaultCountry = computed(() => store.defaultPhoneCountry)
const defaultCountryName = computed(() => countryByCode(defaultCountry.value).name)

// How many of the numbers about to be written are foreign. Worth showing:
// it is the difference between this import and the one that made every
// patient Spanish, and it is a number the clinic can sanity-check.
const foreignNumberCount = computed(() =>
  [...toImport.value, ...toUpdate.value].reduce(
    (total, row) => total + row.numbers.filter((n) => n.country_code !== defaultCountry.value).length,
    0,
  ),
)

function countryFor(patientNumber: string, number: string): string {
  return numberCountries.value.get(practiceHubNumberCountryKey(patientNumber, number)) ?? defaultCountry.value
}

type CsvRow = Record<string, string>
type ContactNumber = PracticeHubContactNumber
type MappedPatient = PracticeHubPatientToCreate
type ExistingPatient = PracticeHubExistingPatient
type MappedUpdate = PracticeHubPatientToUpdate

// Which fields PracticeHub overwrites, and why created_at is not one of them:
// PRACTICEHUB_PATIENT_OVERWRITE_FIELDS in utils/practicehubImport/patients.ts.

const stage = ref<'pick' | 'preview' | 'importing' | 'done' | 'error'>('pick')
useImportWriting(() => stage.value === 'importing')
const dragOver = ref(false)
const fileError = ref('')
const fileName = ref('')
const runError = ref('')

// A plain `ref(store.currentClinicId ?? '')` snapshot here would silently
// stick at '' forever if this component mounts before the account store's
// own async load() resolves -- every imported patient would end up with no
// clinic at all (invisible on the main Patients list once its clinic
// filter applies) with no error anywhere. This stays in sync until the
// user actually touches the dropdown themselves.
const targetClinicId = ref('')
const clinicManuallySet = ref(false)
watch(
  () => store.currentClinicId,
  (id) => {
    if (!clinicManuallySet.value && id) targetClinicId.value = id
  },
  { immediate: true },
)

const toImport = ref<MappedPatient[]>([])
const toUpdate = ref<MappedUpdate[]>([])
const skippedDuplicate = ref(0)
const skippedDeleted = ref(0)
const skippedNoName = ref(0)
// PracticeHub practitioners named as a patient's default who are not on this
// clinic's team yet. A new clinic imports before inviting anyone, so without
// this every default practitioner is silently dropped; adding them under Team
// and reading again fills them in.
const unmatchedPractitioners = ref<{ name: string; patients: number }[]>([])
const totalRows = ref(0)

const importing = ref(false)
const importedCount = ref(0)
const updatedCount = ref(0)
const importErrors = ref<string[]>([])

interface TeamMemberOption { id: string; full_name: string }
const teamMembers = ref<TeamMemberOption[]>([])
onMounted(async () => {
  const { data } = await supabase.from('team_members').select('id, full_name')
  teamMembers.value = data ?? []
  // Picks up the connection saved under Settings -> Import -> PracticeHub ->
  // General, so the country lookup works without re-typing the API key here.
  await loadSavedPracticeHubConnection()
})

function matchPractitioner(name: string): string | null {
  return practiceHubPractitionerMatcher(teamMembers.value)(name)
}

// The rules for each field -- the balance's sign, the join date, the
// language, which fields PracticeHub overwrites and that a blank never
// erases -- live in utils/practicehubImport/patients.ts, shared with the
// server sync.
function formatValue(value: unknown): string {
  return practiceHubBlank(value, t)
}

function fieldLabel(field: string): string {
  return practiceHubPatientFieldLabel(field, t)
}

const languageLabel = practiceHubLanguageLabel

function shownValue(field: string, value: unknown): string {
  return practiceHubShownValue(field, value, t, (id) => teamMembers.value.find((m) => m.id === id)?.full_name)
}

const rawRows = ref<CsvRow[]>([])

async function handleFile(file: File) {
  fileError.value = ''
  fileName.value = file.name

  const text = await file.text()
  const parsed = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true })

  if (parsed.errors.length > 0) {
    fileError.value = t(
      `Could not parse this file: ${parsed.errors[0].message}`,
      `No se pudo procesar este archivo: ${parsed.errors[0].message}`,
    )
    return
  }

  rawRows.value = parsed.data
  // Before the diff, not after: computeDiff() decides each number's country,
  // and the preview should show what will really be written.
  await loadNumberCountries()
  await computeDiff()
  stage.value = 'preview'
}

// Re-derives toImport/toUpdate against the DB's *current* state. Split out
// from handleFile so a retry after a failed import can recompute this from
// scratch -- re-fetching what's already landed -- instead of blindly
// re-running a stale plan that could double-insert whatever succeeded
// before the failure.
async function computeDiff() {
  const rows = rawRows.value
  totalRows.value = rows.length

  const existingPatients: ExistingPatient[] = []
  const PAGE_SIZE = 1000
  for (let page = 0; ; page++) {
    const { data: existing } = await supabase
      .from('patients')
      .select(PRACTICEHUB_EXISTING_PATIENT_COLUMNS)
      .order('id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    existingPatients.push(...((existing ?? []) as ExistingPatient[]))
    if (!existing || existing.length < PAGE_SIZE) break
  }
  photosToBring.value = photoSources.value.length - planProfilePhotos(photoSources.value, existingPatients).alreadyHere

  const diff = practiceHubPatientsDiff(rows, existingPatients, {
    accountId: store.accountId!,
    clinicId: targetClinicId.value || null,
    externalRefFor: (fileRef) => patientNumberFor.value.get(fileRef) ?? fileRef,
    countryFor,
    practitionerFor: matchPractitioner,
    show: shownValue,
    blank: formatValue,
  })
  skippedDeleted.value = diff.skippedDeleted
  skippedNoName.value = diff.skippedNoName

  // Contact numbers are additive-only on an update: only the ones not
  // already on file are kept (practiceHubOnlyNewNumbers).
  const matchedIds = diff.toUpdate.map((u) => u.id)
  const numbersHere: { patient_id: string; number: string }[] = []
  const ID_CHUNK = 200
  for (let i = 0; i < matchedIds.length; i += ID_CHUNK) {
    const idChunk = matchedIds.slice(i, i + ID_CHUNK)
    const { data } = await supabase.from('patient_contact_numbers').select('patient_id, number').in('patient_id', idChunk)
    numbersHere.push(...(data ?? []))
  }
  const { changed, unchanged } = practiceHubOnlyNewNumbers(diff.toUpdate, numbersHere, t)
  skippedDuplicate.value = diff.skippedDuplicate + unchanged

  toImport.value = diff.toImport
  toUpdate.value = changed
  unmatchedPractitioners.value = diff.unmatchedPractitioners
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) handleFile(file)
}
function onFileInput(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) handleFile(file)
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0
  async function worker() {
    while (index < items.length) {
      const item = items[index++]
      await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

async function insertContactNumbers(patientId: string, numbers: ContactNumber[], sourceRow: number) {
  if (numbers.length === 0) return
  const { error } = await supabase.from('patient_contact_numbers').insert(
    numbers.map((n) => ({
      account_id: store.accountId!,
      patient_id: patientId,
      country_code: n.country_code,
      number: n.number,
      is_whatsapp: n.is_whatsapp,
    })),
  )
  if (error) importErrors.value.push(t(`Phone numbers for row ${sourceRow} were not saved: ${error.message}`, `No se guardaron los teléfonos de la fila ${sourceRow}: ${error.message}`))
}

async function runImport() {
  importing.value = true
  stage.value = 'importing'
  runError.value = ''
  importedCount.value = 0
  updatedCount.value = 0
  importErrors.value = []

  try {
    const CHUNK_SIZE = 100
    for (let i = 0; i < toImport.value.length; i += CHUNK_SIZE) {
      const chunk = toImport.value.slice(i, i + CHUNK_SIZE)
      const { data: inserted, error } = await supabase
        .from('patients')
        .insert(chunk.map((c) => c.patient))
        .select('id')

      if (error) {
        importErrors.value.push(
          t(
            `Rows ${chunk[0].sourceRow}-${chunk[chunk.length - 1].sourceRow} were not imported: ${error.message}`,
            `Las filas ${chunk[0].sourceRow}-${chunk[chunk.length - 1].sourceRow} no se importaron: ${error.message}`,
          ),
        )
        continue
      }

      importedCount.value += inserted.length

      const numberRows = chunk.flatMap((c, idx) =>
        c.numbers.map((n) => ({
          account_id: store.accountId!,
          patient_id: inserted[idx].id,
          country_code: n.country_code,
          number: n.number,
          is_whatsapp: n.is_whatsapp,
        })),
      )
      if (numberRows.length > 0) {
        const { error: numbersError } = await supabase.from('patient_contact_numbers').insert(numberRows)
        if (numbersError)
          importErrors.value.push(
            t(
              `Phone numbers for rows ${chunk[0].sourceRow}-${chunk[chunk.length - 1].sourceRow} were not saved: ${numbersError.message}`,
              `No se guardaron los teléfonos de las filas ${chunk[0].sourceRow}-${chunk[chunk.length - 1].sourceRow}: ${numbersError.message}`,
            ),
          )
      }
    }

    const UPDATE_CHUNK_SIZE = 100
    const CONCURRENCY = 8
    for (let i = 0; i < toUpdate.value.length; i += UPDATE_CHUNK_SIZE) {
      const chunk = toUpdate.value.slice(i, i + UPDATE_CHUNK_SIZE)
      await runWithConcurrency(chunk, CONCURRENCY, async (row) => {
        // A row that only brings a new number has nothing to update.
        const { error } = Object.keys(row.updates).length > 0 ? await supabase.from('patients').update(row.updates).eq('id', row.id) : { error: null }
        if (error) {
          importErrors.value.push(
            t(`Row ${row.sourceRow} (${row.label}) was not updated: ${error.message}`, `La fila ${row.sourceRow} (${row.label}) no se actualizó: ${error.message}`),
          )
          return
        }
        updatedCount.value++
        await insertContactNumbers(row.id, row.numbers, row.sourceRow)
      })
    }

    await bringPhotos()

    importing.value = false
    stage.value = 'done'
    showToast(
      t(
        `${importedCount.value} new patients imported, ${updatedCount.value} existing patients updated.`,
        `${importedCount.value} pacientes nuevos importados, ${updatedCount.value} pacientes existentes actualizados.`,
      ),
      importErrors.value.length > 0 ? 'error' : 'success',
    )
  } catch (err) {
    importing.value = false
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
}

// Stores each patient's PracticeHub profile photo as their photo here. Runs
// once the patients exist, and only for those with no photo: one taken in
// QuiroFlow is never replaced, and a second run fetches nothing twice.
//
// A photo that fails does not fail the import. The patients are written by
// then, and running the step again picks up whatever is still missing.
async function bringPhotos() {
  photosImported.value = 0
  photosNotImages.value = 0
  photoProgress.value = null
  if (photoSources.value.length === 0) return

  try {
    const ours: { id: string; external_reference: string | null; photo_storage_path: string | null }[] = []
    const PAGE_SIZE = 1000
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('patients')
        .select('id, external_reference, photo_storage_path')
        .not('external_reference', 'is', null)
        .order('id').range(from, from + PAGE_SIZE - 1)
      if (error) throw new Error(error.message)
      ours.push(...(data ?? []))
      if (!data || data.length < PAGE_SIZE) break
    }

    const { queue } = planProfilePhotos(photoSources.value, ours)
    if (queue.length === 0) return
    photoProgress.value = { done: 0, total: queue.length }
    let failed = 0
    await runWithConcurrency(queue, 6, async (item) => {
      try {
        // Through our server: PracticeHub's bucket sends no CORS headers.
        const blob = await $fetch<Blob>('/api/import/practicehub-file', { method: 'POST', body: { url: item.url }, responseType: 'blob' })
        // What PracticeHub holds as the photo is not always a picture (one
        // was a 2 MB PDF), so the bytes decide.
        const image = sniffImageType(new Uint8Array(await blob.slice(0, 16).arrayBuffer()))
        if (!image) {
          photosNotImages.value++
          return
        }
        // PracticeHub keeps what the camera took: 3 MB a photo at one clinic,
        // for a picture drawn as a small circle. Same shrink a team photo gets.
        const photo = await shrinkImageForUpload(new File([blob], `photo.${image.extension}`, { type: image.contentType }), 'photo')
        const shrunk = photo.type === 'image/jpeg' || photo.type === 'image/png' ? { contentType: photo.type, extension: photo.type === 'image/png' ? 'png' : 'jpg' } : image
        const path = practiceHubPhotoPath(store.accountId!, item.patientId, shrunk.extension)
        const { error: uploadError } = await supabase.storage.from('patient-photos').upload(path, photo, { contentType: shrunk.contentType, upsert: true })
        if (uploadError) throw new Error(uploadError.message)
        const { error: updateError } = await supabase.from('patients').update({ photo_storage_path: path }).eq('id', item.patientId).is('photo_storage_path', null)
        if (updateError) throw new Error(updateError.message)
        photosImported.value++
      } catch {
        failed++
      } finally {
        if (photoProgress.value) photoProgress.value = { done: photoProgress.value.done + 1, total: queue.length }
      }
    })
    if (failed > 0) importErrors.value.push(t(`Profile photos not copied: ${failed}. Run this step again to retry them.`, `Fotos de perfil sin copiar: ${failed}. Vuelve a ejecutar este paso para reintentarlas.`))
  } catch (err) {
    importErrors.value.push(t(`The profile photos were not copied: ${err instanceof Error ? err.message : String(err)}. Run this step again to retry them.`, `No se copiaron las fotos de perfil: ${err instanceof Error ? err.message : String(err)}. Vuelve a ejecutar este paso para reintentarlas.`))
  }
}

async function retryImport() {
  stage.value = 'importing'
  runError.value = ''
  try {
    await computeDiff()
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
    return
  }
  await runImport()
}

function reset() {
  stage.value = 'pick'
  fileName.value = ''
  fileError.value = ''
  tagsUnavailable.value = false
  toImport.value = []
  toUpdate.value = []
  importedCount.value = 0
  updatedCount.value = 0
  importErrors.value = []
}
const introLead = computed(() => t('Brings patients across from PracticeHub. Every other step matches its records to a patient by the reference stored here, so this one has to run first.', 'Trae los pacientes desde PracticeHub. Todos los demás pasos emparejan sus registros con un paciente por la referencia que se guarda aquí, así que este debe ir primero.'))
const introNotes = computed(() => [
        { title: t('Read straight from PracticeHub.', 'Leído directamente de PracticeHub.'), body: t('With the connection saved, nothing needs exporting. A CSV export from PracticeHub’s Settings → Data Exports works too.', 'Con la conexión guardada, no hace falta exportar nada. También sirve una exportación CSV desde Settings → Data Exports de PracticeHub.') },
        { title: t('Nothing is written until you confirm.', 'No se escribe nada hasta que lo confirmes.'), body: t('The preview lists what will be created or updated, so you can check it before pressing Import.', 'La vista previa muestra qué se creará o actualizará, para que lo compruebes antes de pulsar Importar.') },
        { title: t('Safe to run again.', 'Se puede volver a ejecutar.'), body: t('A patient already here, found by their PracticeHub reference or their email, is updated, never duplicated.', 'Un paciente que ya está aquí, encontrado por su referencia de PracticeHub o su correo, se actualiza, nunca se duplica.') },
])

// Ties each visible <label> to the field under it (for/id), so a screen
// reader announces the field by its name.
const fieldId = useId()
</script>

<template>
  <div>
    <ImportIntro :lead="introLead" :notes="introNotes" />

    <div v-if="stage === 'pick'" class="mt-4 space-y-3">
      <div class="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-ink-900">{{ t('From PracticeHub', 'Desde PracticeHub') }}</p>
          <p class="text-[12.5px] text-ink-muted2">
            {{ connection
              ? (loadingFromApi ? apiProgress : t('Reads every patient through the saved connection. Takes a minute or two.', 'Lee todos los pacientes con la conexión guardada. Tarda un minuto o dos.'))
              : t('Save the connection first, under Connection.', 'Guarda antes la conexión, en Conexión.') }}
          </p>
        </div>
        <button
          type="button"
          class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover disabled:opacity-50"
          :disabled="!connection || loadingFromApi"
          data-cy="ph-patients-from-api"
          @click="loadFromPracticeHub"
        >
          {{ loadingFromApi ? t('Reading…', 'Leyendo…') : t('Read patients', 'Leer pacientes') }}
        </button>
      </div>
      <ImportPracticeHubReadsNote />
      <div
        class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center"
        :class="dragOver ? 'border-brand bg-brand-tint' : 'border-line-control bg-surface'"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <p class="text-sm text-ink-600">{{ t('Or drag and drop a PracticeHub CSV export here, or', 'O arrastra y suelta aquí una exportación CSV de PracticeHub, o') }}</p>
        <label class="mt-2 cursor-pointer text-sm font-medium text-brand-text hover:text-brand-text">
          {{ t('browse for a file', 'busca un archivo') }}
          <input type="file" accept=".csv" class="hidden" @change="onFileInput" />
        </label>
      </div>
      <p v-if="fileError" class="mt-2 text-sm text-danger-text">{{ fileError }}</p>
    </div>

    <div v-else-if="stage === 'preview'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-line bg-surface p-4">
        <p class="text-sm font-medium text-ink-900">{{ fileName }}</p>
        <dl class="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          <div><dt class="text-ink-muted2">{{ t('Total rows', 'Filas totales') }}</dt><dd class="font-medium text-ink-900">{{ totalRows }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Will import', 'Se importarán') }}</dt><dd class="font-medium text-success-text">{{ toImport.length }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Will update', 'Se actualizarán') }}</dt><dd class="font-medium text-brand-text">{{ toUpdate.length }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('No changes', 'Sin cambios') }}</dt><dd class="font-medium text-ink-900">{{ skippedDuplicate }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Skipped (deleted or no name)', 'Omitidos (borrados o sin nombre)') }}</dt><dd class="font-medium text-ink-900">{{ skippedDeleted + skippedNoName }}</dd></div>
        </dl>
        <!-- The CSV has no country for a phone number; PracticeHub's API
             does. Say which of the two answered, because the fallback makes
             every number Spanish and that is exactly the bug this replaced. -->
        <p v-if="photosToBring > 0" class="mt-3 text-[12.5px] text-ink-700" data-cy="ph-patients-photos">
          {{ t(`Profile photos to bring over from PracticeHub: ${photosToBring}`, `Fotos de perfil por traer de PracticeHub: ${photosToBring}`) }}
        </p>
        <p v-if="countryLookupState === 'ready'" class="mt-3 text-[12.5px] text-ink-muted2">
          {{ t(
            `Phone countries read from PracticeHub · ${foreignNumberCount} ${foreignNumberCount === 1 ? 'number' : 'numbers'} outside ${defaultCountryName}`,
            `Países de los teléfonos leídos de PracticeHub · ${foreignNumberCount} ${foreignNumberCount === 1 ? 'número' : 'números'} fuera de ${defaultCountryName}`,
          ) }}
        </p>
        <p v-else-if="countryLookupState === 'unavailable'" class="mt-3 text-[12.5px] text-warning-text">
          {{ t(
            `No PracticeHub connection, so every phone number will be saved as ${defaultCountryName}. Save the connection under Connection, then load this file again to get each number's real country.`,
            `Sin conexión con PracticeHub, todos los teléfonos se guardarán como de ${defaultCountryName}. Guarda la conexión en Conexión y vuelve a cargar este archivo para obtener el país real de cada número.`,
          ) }}
        </p>
        <p v-if="tagsUnavailable" class="mt-1 text-[12.5px] text-warning-text" data-cy="ph-patients-no-tags">
          {{ t(
            'Tags are only in PracticeHub 2.0’s API, so they are not included. Save the 2.0 key under Connection and read again to bring them.',
            'Las etiquetas solo están en la API de PracticeHub 2.0, así que no se incluyen. Guarda la clave 2.0 en Conexión y vuelve a leer para traerlas.',
          ) }}
        </p>
        <p v-if="unmatchedPractitioners.length > 0" class="mt-1 text-[12.5px] text-warning-text" data-cy="ph-patients-unmatched-practitioners">
          {{ t(
            `Not on your team yet, so these patients get no default practitioner: ${unmatchedPractitioners.map((p) => `${p.name} (${p.patients})`).join(', ')}. Add them under Settings → Team with the same name and read again.`,
            `Aún no están en tu equipo, así que estos pacientes quedan sin profesional habitual: ${unmatchedPractitioners.map((p) => `${p.name} (${p.patients})`).join(', ')}. Añádelos en Ajustes → Equipo con el mismo nombre y vuelve a leer.`,
          ) }}
        </p>
      </div>

      <div>
        <label :for="`${fieldId}-targetClinicId`" class="block text-sm font-medium text-ink-700">{{ t('Import into clinic', 'Importar a la clínica') }}</label>
        <select :id="`${fieldId}-targetClinicId`"
          v-model="targetClinicId"
          class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @change="clinicManuallySet = true"
        >
          <option value="">{{ t('No primary clinic', 'Sin clínica principal') }}</option>
          <option v-for="c in store.clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>

      <div class="overflow-hidden rounded-lg border border-line bg-surface">
        <table class="w-full text-sm">
          <thead class="border-b border-line bg-surface-subtle text-left text-xs font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('Name', 'Nombre') }}</th>
              <th class="px-3 py-2">{{ t('Email', 'Correo electrónico') }}</th>
              <th class="px-3 py-2">{{ t('Balance', 'Saldo') }}</th>
              <th class="px-3 py-2">{{ t('Language', 'Idioma') }}</th>
              <th class="px-3 py-2">{{ t('Tags', 'Etiquetas') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-for="(row, i) in toImport.slice(0, 10)" :key="i">
              <td class="px-3 py-2 text-ink-900">{{ row.patient.first_name }} {{ row.patient.last_name }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.patient.email ?? t('N/A', 'N/D') }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ formatEur((row.patient.balance_cents ?? 0)) }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ languageLabel(row.patient.preferred_language) }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ (row.patient.tags ?? []).join(', ') || t('N/A', 'N/D') }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="toImport.length > 10" class="border-t border-line-divider px-3 py-2 text-xs text-ink-faint">
          + {{ toImport.length - 10 }} {{ t('more rows', 'filas más') }}
        </p>
      </div>

      <div v-if="toUpdate.length > 0" class="overflow-hidden rounded-lg border border-line bg-surface">
        <div class="border-b border-line-divider px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted2">
          {{ t('Sample of changes to existing patients', 'Muestra de cambios en pacientes existentes') }}
        </div>
        <table class="w-full text-sm">
          <thead class="border-b border-line bg-surface-subtle text-left text-xs font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('Patient', 'Paciente') }}</th>
              <th class="px-3 py-2">{{ t('Field', 'Campo') }}</th>
              <th class="px-3 py-2">{{ t('Now', 'Ahora') }}</th>
              <th class="px-3 py-2">{{ t('After import', 'Tras importar') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <template v-for="(row, i) in toUpdate.slice(0, 5)" :key="i">
              <tr v-for="(d, j) in row.diff" :key="j">
                <td class="px-3 py-2 text-ink-900">{{ j === 0 ? row.label : '' }}</td>
                <td class="px-3 py-2 text-ink-muted2">{{ fieldLabel(d.field) }}</td>
                <td class="px-3 py-2 text-ink-muted2">{{ d.from }}</td>
                <td class="px-3 py-2 text-ink-900">{{ d.to }}</td>
              </tr>
            </template>
          </tbody>
        </table>
        <p v-if="toUpdate.length > 5" class="border-t border-line-divider px-3 py-2 text-xs text-ink-faint">
          + {{ toUpdate.length - 5 }} {{ t('more patients to update', 'pacientes más por actualizar') }}
        </p>
      </div>

      <div class="flex gap-3">
        <button
          type="button"
          :disabled="toImport.length === 0 && toUpdate.length === 0 && photosToBring === 0"
          class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover disabled:opacity-50"
          @click="runImport"
        >
          {{ t(`Import ${toImport.length}, update ${toUpdate.length}`, `Importar ${toImport.length}, actualizar ${toUpdate.length}`) }}
        </button>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Cancel', 'Cancelar') }}
        </button>
      </div>
    </div>

    <div v-else-if="stage === 'importing'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p v-if="photoProgress" class="text-sm text-ink-600" data-cy="ph-patients-photo-progress">
        {{ t(`Bringing profile photos… ${photoProgress.done} / ${photoProgress.total}`, `Trayendo fotos de perfil… ${photoProgress.done} / ${photoProgress.total}`) }}
      </p>
      <p v-else class="text-sm text-ink-600">
        {{
          t(
            `Importing… ${importedCount + updatedCount} / ${toImport.length + toUpdate.length}`,
            `Importando… ${importedCount + updatedCount} / ${toImport.length + toUpdate.length}`,
          )
        }}
      </p>
    </div>

    <div v-else-if="stage === 'error'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('The import stopped before it finished.', 'La importación se detuvo antes de terminar.') }}</p>
        <p class="mt-1">{{ t('Patients written before it stopped are kept. Retry compares again and carries on without duplicating them.', 'Los pacientes escritos antes de detenerse se conservan. Reintentar vuelve a comparar y sigue sin duplicarlos.') }}</p>
        <p class="mt-1 text-[12.5px] opacity-80">{{ runError }}</p>
      </div>
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover" @click="retryImport">
        {{ t('Retry', 'Reintentar') }}
      </button>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-4">
      <p v-if="photosImported > 0 || photosNotImages > 0" class="text-[12.5px] text-ink-700" data-cy="ph-patients-photos-done">
        {{ t(`Profile photos brought over: ${photosImported}.`, `Fotos de perfil traídas: ${photosImported}.`) }}
        <template v-if="photosNotImages > 0">
          {{ t(`Left out because PracticeHub holds a PDF or other document there, not a picture: ${photosNotImages}.`, `No traídas porque en PracticeHub hay un PDF u otro documento, no una imagen: ${photosNotImages}.`) }}
        </template>
      </p>
      <div v-if="importErrors.length > 0" class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Some rows were not saved:', 'Algunas filas no se guardaron:') }}</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="(e, i) in importErrors" :key="i">{{ e }}</li>
        </ul>
      </div>
      <div class="flex gap-3">
        <NuxtLink to="/patients" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover">
          {{ t('View patients', 'Ver pacientes') }}
        </NuxtLink>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Start again', 'Empezar de nuevo') }}
        </button>
      </div>
    </div>
  </div>
</template>
