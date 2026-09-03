<script setup lang="ts">
import Papa from 'papaparse'
import type { TablesInsert, TablesUpdate } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

type CsvRow = Record<string, string>

interface MappedAppointment {
  appointment: TablesInsert<'appointments'>
  note: string | null
  sourceRow: number
}

// PracticeHub stays authoritative for these fields right up to cutover --
// a re-import matching an existing appointment overwrites them
// unconditionally (confirmed with the clinic, including appointments
// already checked in/flowed through in QuiroFlow). Deliberately never
// touched: `rescheduled` (keeps a detected time change silent -- no
// reschedule automation fires for a bulk historical sync), `note`,
// `external_reference`, `created_at`, `room_id`, and all QuiroFlow-native
// confirmation/reminder/check-in/flow timestamps.
const OVERWRITE_FIELDS = ['starts_at', 'ends_at', 'status', 'practitioner_id', 'practitioner_name', 'appointment_type_id'] as const
type AppointmentOverwritable = Pick<TablesInsert<'appointments'>, (typeof OVERWRITE_FIELDS)[number]>

interface ExistingAppointment {
  id: string
  starts_at: string
  ends_at: string
  status: string
  practitioner_id: string | null
  practitioner_name: string | null
  appointment_type_id: string | null
}

interface FieldDiff { field: string; from: string; to: string }

interface MappedUpdate {
  id: string
  label: string
  updates: TablesUpdate<'appointments'>
  diff: FieldDiff[]
  note: string | null
  sourceRow: number
}

function formatValue(value: unknown): string {
  return value === null || value === undefined || value === '' ? '(blank)' : String(value)
}

const DATE_FIELDS = new Set(['starts_at', 'ends_at'])

// starts_at/ends_at come back from Supabase as Postgres's own timestamptz
// serialization (e.g. "2023-11-06T15:00:00+00:00"), while the freshly-parsed
// CSV value here is JS's toISOString() format (e.g.
// "2023-11-06T15:00:00.000Z") -- same instant, different string, so a plain
// `!==` flagged every single appointment as changed regardless of whether
// its time actually moved.
function valuesDiffer(field: string, value: unknown, existingValue: unknown): boolean {
  if (DATE_FIELDS.has(field)) return new Date(value as string).getTime() !== new Date(existingValue as string).getTime()
  return value !== existingValue
}

function buildAppointmentUpdate(existing: ExistingAppointment, incoming: AppointmentOverwritable) {
  const updates: TablesUpdate<'appointments'> = {}
  const diff: FieldDiff[] = []
  for (const field of OVERWRITE_FIELDS) {
    const value = incoming[field]
    if (value === null || value === undefined || value === '') continue
    const existingValue = existing[field]
    if (valuesDiffer(field, value, existingValue)) {
      ;(updates as Record<string, unknown>)[field] = value
      diff.push({ field, from: formatValue(existingValue), to: formatValue(value) })
    }
  }
  return { updates, diff }
}

const stage = ref<'pick' | 'mapping' | 'preview' | 'importing' | 'done' | 'error'>('pick')
const dragOver = ref(false)
const fileError = ref('')
const fileName = ref('')
const runError = ref('')
const targetClinicId = ref(store.currentClinicId ?? '')

const rawRows = ref<CsvRow[]>([])
const distinctPractitioners = ref<string[]>([])
const distinctTypes = ref<string[]>([])
const practitionerMap = ref<Record<string, string>>({}) // name -> team_member id, '' = keep as label only
const typeMap = ref<Record<string, string>>({}) // name -> appointment_type id, '__create__', or ''

interface TeamMemberOption { id: string; full_name: string }
interface AppointmentTypeOption { id: string; name: string }
const teamMembers = ref<TeamMemberOption[]>([])
const appointmentTypes = ref<AppointmentTypeOption[]>([])

onMounted(async () => {
  const [{ data: tm }, { data: at }] = await Promise.all([
    supabase.from('team_members').select('id, full_name'),
    supabase.from('appointment_types').select('id, name'),
  ])
  teamMembers.value = tm ?? []
  appointmentTypes.value = at ?? []
})

const toImport = ref<MappedAppointment[]>([])
const toUpdate = ref<MappedUpdate[]>([])
const totalRows = ref(0)
const skippedNoPatient = ref(0)
const skippedDuplicate = ref(0)
const skippedInvalidDate = ref(0)
const preparingPreview = ref(false)

const importing = ref(false)
const importedCount = ref(0)
const updatedCount = ref(0)
const importErrors = ref<string[]>([])

function mapStatus(raw: string): string {
  switch (raw.trim().toLowerCase()) {
    case 'processed':
      return 'completed'
    case 'cancelled':
      return 'cancelled'
    case 'missed':
      return 'no_show'
    default:
      return 'booked' // pending, arrived
  }
}

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
  totalRows.value = parsed.data.length

  const practSet = new Set<string>()
  const typeSet = new Set<string>()
  for (const row of rawRows.value) {
    if (row['Practitioner']?.trim()) practSet.add(row['Practitioner'].trim())
    if (row['Appointment Type']?.trim()) typeSet.add(row['Appointment Type'].trim())
  }
  distinctPractitioners.value = [...practSet].sort()
  distinctTypes.value = [...typeSet].sort()

  const pMap: Record<string, string> = {}
  for (const name of distinctPractitioners.value) {
    const match = teamMembers.value.find((m) => m.full_name.trim().toLowerCase() === name.toLowerCase())
    pMap[name] = match?.id ?? ''
  }
  practitionerMap.value = pMap

  const tMap: Record<string, string> = {}
  for (const name of distinctTypes.value) {
    const match = appointmentTypes.value.find((t) => t.name.trim().toLowerCase() === name.toLowerCase())
    tMap[name] = match?.id ?? ''
  }
  typeMap.value = tMap

  stage.value = 'mapping'
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

async function proceedToPreview() {
  preparingPreview.value = true

  // Create any appointment types the user chose to create fresh.
  for (const name of distinctTypes.value) {
    if (typeMap.value[name] === '__create__') {
      const { data } = await supabase
        .from('appointment_types')
        .insert({ account_id: store.accountId!, name })
        .select('id')
        .single()
      if (data) {
        typeMap.value[name] = data.id
        appointmentTypes.value.push({ id: data.id, name })
      }
    }
  }

  const PAGE_SIZE = 1000
  const patientByRef = new Map<string, string>()
  for (let page = 0; ; page++) {
    const { data } = await supabase
      .from('patients')
      .select('id, external_reference')
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const p of data ?? []) {
      if (p.external_reference) patientByRef.set(p.external_reference, p.id)
    }
    if (!data || data.length < PAGE_SIZE) break
  }

  const existingByRef = new Map<string, ExistingAppointment>()
  for (let page = 0; ; page++) {
    const { data } = await supabase
      .from('appointments')
      .select('id, external_reference, starts_at, ends_at, status, practitioner_id, practitioner_name, appointment_type_id')
      .not('external_reference', 'is', null)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const a of data ?? []) {
      if (a.external_reference) existingByRef.set(a.external_reference, a as ExistingAppointment)
    }
    if (!data || data.length < PAGE_SIZE) break
  }

  skippedNoPatient.value = 0
  skippedDuplicate.value = 0
  skippedInvalidDate.value = 0
  const mapped: MappedAppointment[] = []
  const updates: MappedUpdate[] = []
  const matchedIds: string[] = []

  rawRows.value.forEach((row, index) => {
    const extRef = row['Internal Appt ID']?.trim() || row['Imported Appt ID']?.trim() || ''
    const existing = extRef ? existingByRef.get(extRef) : undefined

    const patientRef = row['Patient Number']?.trim()
    const patientId = patientRef ? patientByRef.get(patientRef) : undefined
    if (!existing && !patientId) {
      skippedNoPatient.value++
      return
    }

    const start = row['Start']?.trim() ? new Date(row['Start'].trim().replace(' ', 'T')) : null
    const end = row['End']?.trim() ? new Date(row['End'].trim().replace(' ', 'T')) : null
    if (!start || Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) {
      skippedInvalidDate.value++
      return
    }

    const practName = row['Practitioner']?.trim() || ''
    const typeName = row['Appointment Type']?.trim() || ''
    const note = row['Note']?.trim() || null

    if (!existing) {
      mapped.push({
        sourceRow: index + 2,
        note,
        appointment: {
          account_id: store.accountId!,
          clinic_id: targetClinicId.value,
          patient_id: patientId!,
          practitioner_id: (practName && practitionerMap.value[practName]) || null,
          practitioner_name: practName || null,
          appointment_type_id: (typeName && typeMap.value[typeName]) || null,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          status: mapStatus(row['Status'] || ''),
          external_reference: extRef || null,
        },
      })
      return
    }

    matchedIds.push(existing.id)
    const incoming: AppointmentOverwritable = {
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      status: mapStatus(row['Status'] || ''),
      practitioner_id: (practName && practitionerMap.value[practName]) || null,
      practitioner_name: practName || null,
      appointment_type_id: (typeName && typeMap.value[typeName]) || null,
    }
    const { updates: fieldUpdates, diff } = buildAppointmentUpdate(existing, incoming)
    if (Object.keys(fieldUpdates).length === 0) {
      skippedDuplicate.value++
      return
    }
    updates.push({
      id: existing.id,
      label: start.toLocaleString(),
      updates: fieldUpdates,
      diff,
      note,
      sourceRow: index + 2,
    })
  })

  // visit_notes are additive-only on an update -- never overwrite a note a
  // practitioner already wrote for this appointment.
  if (matchedIds.length > 0) {
    const existingNoteAppointmentIds = new Set<string>()
    const ID_CHUNK = 200
    for (let i = 0; i < matchedIds.length; i += ID_CHUNK) {
      const idChunk = matchedIds.slice(i, i + ID_CHUNK)
      const { data } = await supabase.from('visit_notes').select('appointment_id').in('appointment_id', idChunk)
      for (const n of data ?? []) existingNoteAppointmentIds.add(n.appointment_id)
    }
    for (const u of updates) {
      if (existingNoteAppointmentIds.has(u.id)) u.note = null
    }
  }

  toImport.value = mapped
  toUpdate.value = updates
  preparingPreview.value = false
  stage.value = 'preview'
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

async function insertVisitNote(appointmentId: string, note: string | null, sourceRow: number) {
  if (!note) return
  const { error } = await supabase.from('visit_notes').insert({ account_id: store.accountId!, appointment_id: appointmentId, body: note })
  if (error) importErrors.value.push(`Note for row ${sourceRow}: ${error.message}`)
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
        .from('appointments')
        .insert(chunk.map((c) => c.appointment))
        .select('id')

      if (error) {
        importErrors.value.push(
          t(
            `Rows ${chunk[0].sourceRow}-${chunk[chunk.length - 1].sourceRow}: ${error.message}`,
            `Filas ${chunk[0].sourceRow}-${chunk[chunk.length - 1].sourceRow}: ${error.message}`,
          ),
        )
        continue
      }
      importedCount.value += inserted.length

      const noteRows = chunk.flatMap((c, idx) =>
        c.note
          ? [{ account_id: store.accountId!, appointment_id: inserted[idx].id, body: c.note }]
          : [],
      )
      if (noteRows.length > 0) {
        const { error: noteError } = await supabase.from('visit_notes').insert(noteRows)
        if (noteError)
          importErrors.value.push(
            t(
              `Notes for rows near ${chunk[0].sourceRow}: ${noteError.message}`,
              `Notas de filas cerca de ${chunk[0].sourceRow}: ${noteError.message}`,
            ),
          )
      }
    }

    const UPDATE_CHUNK_SIZE = 100
    const CONCURRENCY = 8
    for (let i = 0; i < toUpdate.value.length; i += UPDATE_CHUNK_SIZE) {
      const chunk = toUpdate.value.slice(i, i + UPDATE_CHUNK_SIZE)
      await runWithConcurrency(chunk, CONCURRENCY, async (row) => {
        const { error } = await supabase.from('appointments').update(row.updates).eq('id', row.id)
        if (error) {
          importErrors.value.push(`Row ${row.sourceRow}: ${error.message}`)
          return
        }
        updatedCount.value++
        await insertVisitNote(row.id, row.note, row.sourceRow)
      })
    }

    importing.value = false
    stage.value = 'done'
  } catch (err) {
    importing.value = false
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
}

async function retryImport() {
  stage.value = 'importing'
  runError.value = ''
  try {
    await proceedToPreview()
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
  rawRows.value = []
  toImport.value = []
  toUpdate.value = []
  importedCount.value = 0
  updatedCount.value = 0
  importErrors.value = []
}
</script>

<template>
  <div>
    <p class="text-sm text-ink-muted2">
      {{
        t(
          'Export "Appointments" as CSV from PracticeHub (Settings → Data Exports), then drop it here.',
          'Exporta "Appointments" como CSV desde PracticeHub (Settings → Data Exports) y luego suéltalo aquí.',
        )
      }}
    </p>

    <div v-if="stage === 'pick'" class="mt-4">
      <div
        class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center"
        :class="dragOver ? 'border-brand bg-brand-tint' : 'border-line-control bg-surface'"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <p class="text-sm text-ink-600">{{ t('Drag and drop a CSV file here, or', 'Arrastra y suelta un archivo CSV aquí, o') }}</p>
        <label class="mt-2 cursor-pointer text-sm font-medium text-brand-text hover:text-brand-text">
          {{ t('browse for a file', 'busca un archivo') }}
          <input type="file" accept=".csv" class="hidden" @change="onFileInput" />
        </label>
      </div>
      <p v-if="fileError" class="mt-2 text-sm text-danger-text">{{ fileError }}</p>
    </div>

    <div v-else-if="stage === 'mapping'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-line bg-surface p-4">
        <p class="text-sm font-medium text-ink-900">{{ fileName }} &middot; {{ totalRows }} {{ t('rows', 'filas') }}</p>
      </div>

      <div>
        <label class="block text-sm font-medium text-ink-700">{{ t('Import into clinic', 'Importar a la clínica') }}</label>
        <select v-model="targetClinicId" class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
          <option value="" disabled>{{ t('Select a clinic', 'Selecciona una clínica') }}</option>
          <option v-for="c in store.clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>

      <div v-if="distinctPractitioners.length > 0" class="rounded-lg border border-line bg-surface p-4">
        <h3 class="text-sm font-semibold text-ink-900">{{ t('Practitioners', 'Profesionales') }}</h3>
        <p class="mt-1 text-xs text-ink-muted2">
          {{
            t(
              'Match each imported practitioner name to a real team member, or keep it as a label only (no login yet, so you can still see who saw the patient — invite them properly from Settings → Team Members later).',
              'Empareja cada nombre de profesional importado con un miembro real del equipo, o déjalo solo como etiqueta (sin acceso todavía, para que puedas seguir viendo quién atendió al paciente; invítalo correctamente desde Settings → Team Members más adelante).',
            )
          }}
        </p>
        <div class="mt-3 space-y-2">
          <div v-for="name in distinctPractitioners" :key="name" class="flex items-center justify-between gap-3">
            <span class="text-sm text-ink-700">{{ name }}</span>
            <select v-model="practitionerMap[name]" class="w-56 rounded-md border border-line-control bg-surface px-2 py-1.5 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
              <option value="">{{ t('Keep as label only', 'Dejar solo como etiqueta') }}</option>
              <option v-for="m in teamMembers" :key="m.id" :value="m.id">{{ m.full_name }}</option>
            </select>
          </div>
        </div>
      </div>

      <div v-if="distinctTypes.length > 0" class="rounded-lg border border-line bg-surface p-4">
        <h3 class="text-sm font-semibold text-ink-900">{{ t('Appointment types', 'Tipos de cita') }}</h3>
        <div class="mt-3 space-y-2">
          <div v-for="name in distinctTypes" :key="name" class="flex items-center justify-between gap-3">
            <span class="text-sm text-ink-700">{{ name }}</span>
            <select v-model="typeMap[name]" class="w-56 rounded-md border border-line-control bg-surface px-2 py-1.5 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
              <option value="">{{ t('No type', 'Sin tipo') }}</option>
              <option value="__create__">{{ t(`+ Create "${name}"`, `+ Crear "${name}"`) }}</option>
              <option v-for="t in appointmentTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </div>
        </div>
      </div>

      <div class="flex gap-3">
        <button
          type="button"
          :disabled="!targetClinicId || preparingPreview"
          class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          @click="proceedToPreview"
        >
          {{ preparingPreview ? t('Preparing…', 'Preparando…') : t('Continue', 'Continuar') }}
        </button>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Cancel', 'Cancelar') }}
        </button>
      </div>
    </div>

    <div v-else-if="stage === 'preview'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-line bg-surface p-4">
        <dl class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          <div><dt class="text-ink-muted2">{{ t('Total rows', 'Filas totales') }}</dt><dd class="font-medium text-ink-900">{{ totalRows }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Will import', 'Se importarán') }}</dt><dd class="font-medium text-success-text">{{ toImport.length }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Will update', 'Se actualizarán') }}</dt><dd class="font-medium text-brand-text">{{ toUpdate.length }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('No matching patient', 'Sin paciente coincidente') }}</dt><dd class="font-medium text-ink-900">{{ skippedNoPatient }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('No changes / bad dates', 'Sin cambios / fechas incorrectas') }}</dt><dd class="font-medium text-ink-900">{{ skippedDuplicate + skippedInvalidDate }}</dd></div>
        </dl>
      </div>

      <div class="overflow-hidden rounded-lg border border-line bg-surface">
        <table class="w-full text-sm">
          <thead class="border-b border-line bg-surface-subtle text-left text-xs font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('Date', 'Fecha') }}</th>
              <th class="px-3 py-2">{{ t('Practitioner', 'Profesional') }}</th>
              <th class="px-3 py-2">{{ t('Status', 'Estado') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-for="(row, i) in toImport.slice(0, 10)" :key="i">
              <td class="px-3 py-2 text-ink-900">{{ new Date(row.appointment.starts_at).toLocaleString() }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.appointment.practitioner_name ?? t('N/A', 'N/D') }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.appointment.status }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="toImport.length > 10" class="border-t border-line-divider px-3 py-2 text-xs text-ink-faint">
          + {{ toImport.length - 10 }} {{ t('more rows', 'filas más') }}
        </p>
      </div>

      <div v-if="toUpdate.length > 0" class="overflow-hidden rounded-lg border border-line bg-surface">
        <div class="border-b border-line-divider px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted2">
          Sample of changes to existing appointments
        </div>
        <table class="w-full text-sm">
          <thead class="border-b border-line bg-surface-subtle text-left text-xs font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-3 py-2">Appointment</th>
              <th class="px-3 py-2">Field</th>
              <th class="px-3 py-2">Current</th>
              <th class="px-3 py-2">New</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <template v-for="(row, i) in toUpdate.slice(0, 5)" :key="i">
              <tr v-for="(d, j) in row.diff" :key="j">
                <td class="px-3 py-2 text-ink-900">{{ j === 0 ? row.label : '' }}</td>
                <td class="px-3 py-2 text-ink-muted2">{{ d.field }}</td>
                <td class="px-3 py-2 text-ink-muted2">{{ d.from }}</td>
                <td class="px-3 py-2 text-ink-900">{{ d.to }}</td>
              </tr>
            </template>
          </tbody>
        </table>
        <p v-if="toUpdate.length > 5" class="border-t border-line-divider px-3 py-2 text-xs text-ink-faint">
          + {{ toUpdate.length - 5 }} more appointments to update
        </p>
      </div>

      <div class="flex gap-3">
        <button
          type="button"
          :disabled="toImport.length === 0 && toUpdate.length === 0"
          class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
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
      <p class="text-sm text-ink-600">
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
        <p class="font-medium">{{ t('Import failed:', 'Error al importar:') }}</p>
        <p class="mt-1">{{ runError }}</p>
      </div>
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover" @click="retryImport">
        {{ t('Retry', 'Reintentar') }}
      </button>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-success-border bg-success-bg p-4 text-sm text-success-text">
        {{
          t(
            `Imported ${importedCount} appointments. Updated ${updatedCount} existing appointments.`,
            `Se importaron ${importedCount} citas. Se actualizaron ${updatedCount} citas existentes.`,
          )
        }}
      </div>
      <div v-if="importErrors.length > 0" class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Some rows failed:', 'Algunas filas fallaron:') }}</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="(e, i) in importErrors" :key="i">{{ e }}</li>
        </ul>
      </div>
      <div class="flex gap-3">
        <NuxtLink to="/calendar" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">
          {{ t('View Calendar', 'Ver calendario') }}
        </NuxtLink>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Import another file', 'Importar otro archivo') }}
        </button>
      </div>
    </div>
  </div>
</template>
