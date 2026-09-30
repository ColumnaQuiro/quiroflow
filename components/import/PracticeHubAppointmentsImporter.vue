<script setup lang="ts">
import Papa from 'papaparse'
import type { TablesInsert, TablesUpdate } from '~/types/database.types'
import { matchIncomingAppointments, type HeldReason, type IncomingAppointment } from '~/utils/importAppointmentMatch'
import { quiroflowKeeps, type KeptReason } from '~/utils/importAppointmentGuard'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

type CsvRow = Record<string, string>

interface MappedAppointment {
  appointment: TablesInsert<'appointments'>
  note: string | null
  sourceRow: number
}

// A re-import matching an existing appointment overwrites these from
// PracticeHub -- unless QuiroFlow has acted on the visit (moved it, or
// recorded what happened at it), in which case QuiroFlow's version stands and
// the row is listed as kept (utils/importAppointmentGuard.ts). Deliberately never
// touched: `rescheduled` (keeps a detected time change silent -- no
// reschedule automation fires for a bulk historical sync), `note`,
// `external_reference`, `created_at`, `room_id`, and all QuiroFlow-native
// confirmation/reminder/check-in/flow timestamps. The one exception to
// `external_reference` is a visit adopted by a re-created PracticeHub
// appointment (utils/importAppointmentMatch.ts): it takes the new id, so the
// next run and the ledger import find it by id.
const OVERWRITE_FIELDS = ['starts_at', 'ends_at', 'status', 'practitioner_id', 'practitioner_name', 'appointment_type_id'] as const
type AppointmentOverwritable = Pick<TablesInsert<'appointments'>, (typeof OVERWRITE_FIELDS)[number]>

interface ExistingAppointment {
  id: string
  external_reference: string | null
  patient_id: string
  clinic_id: string | null
  starts_at: string
  ends_at: string
  status: string
  rescheduled: boolean
  checked_in_at: string | null
  practitioner_id: string | null
  practitioner_name: string | null
  appointment_type_id: string | null
}

interface FieldDiff { field: string; from: string; to: string }

interface MappedUpdate {
  id: string
  label: string
  /** Set when a re-created PracticeHub appointment takes over this visit. */
  adopted: boolean
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

interface HeldRow {
  sourceRow: number
  ref: string
  patientRef: string
  label: string
  reason: HeldReason
}

const toImport = ref<MappedAppointment[]>([])
const toUpdate = ref<MappedUpdate[]>([])
const held = ref<HeldRow[]>([])

/** A matched visit QuiroFlow has acted on: PracticeHub's version is shown, not applied. */
interface KeptRow {
  sourceRow: number
  ref: string
  here: string
  practiceHub: string
  reason: KeptReason
}
const kept = ref<KeptRow[]>([])
const adoptedCount = computed(() => toUpdate.value.filter((u) => u.adopted).length)
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
        // Not bookable online until the clinic says so on the type's page.
        .insert({ account_id: store.accountId!, name, online_booking_enabled: false })
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
      .order('id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const p of data ?? []) {
      if (p.external_reference) patientByRef.set(p.external_reference, p.id)
    }
    if (!data || data.length < PAGE_SIZE) break
  }

  // Every appointment, not only imported ones: a visit entered here carries
  // no PracticeHub id and can still be the one a re-created appointment
  // describes.
  const existingById = new Map<string, ExistingAppointment>()
  for (let page = 0; ; page++) {
    const { data } = await supabase
      .from('appointments')
      .select('id, external_reference, patient_id, clinic_id, starts_at, ends_at, status, rescheduled, checked_in_at, practitioner_id, practitioner_name, appointment_type_id')
      .order('id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const a of data ?? []) existingById.set(a.id, a as ExistingAppointment)
    if (!data || data.length < PAGE_SIZE) break
  }
  const existingRefs = new Set([...existingById.values()].map((a) => a.external_reference).filter(Boolean))
  const { data: clinic } = await supabase.from('clinics').select('timezone').eq('id', targetClinicId.value).maybeSingle()

  skippedNoPatient.value = 0
  skippedDuplicate.value = 0
  skippedInvalidDate.value = 0
  const mapped: MappedAppointment[] = []
  const updates: MappedUpdate[] = []
  const heldRows: HeldRow[] = []
  const keptRows: KeptRow[] = []
  const matchedIds: string[] = []

  const refOf = (row: CsvRow) => row['Internal Appt ID']?.trim() || row['Imported Appt ID']?.trim() || ''
  const refsInFile = new Set(rawRows.value.map(refOf).filter(Boolean))

  const parsed: { index: number; row: CsvRow; extRef: string; patientId: string | undefined; start: Date; end: Date }[] = []
  rawRows.value.forEach((row, index) => {
    const extRef = refOf(row)
    const patientRef = row['Patient Number']?.trim()
    const patientId = patientRef ? patientByRef.get(patientRef) : undefined
    if (!existingRefs.has(extRef) && !patientId) {
      skippedNoPatient.value++
      return
    }

    const start = row['Start']?.trim() ? new Date(row['Start'].trim().replace(' ', 'T')) : null
    const end = row['End']?.trim() ? new Date(row['End'].trim().replace(' ', 'T')) : null
    if (!start || Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) {
      skippedInvalidDate.value++
      return
    }
    parsed.push({ index, row, extRef, patientId, start, end })
  })

  const incoming: IncomingAppointment[] = parsed.map((p) => ({
    key: p.index,
    ref: p.extRef || null,
    patientId: p.patientId ?? null,
    startsAt: p.start.toISOString(),
    endsAt: p.end.toISOString(),
    status: mapStatus(p.row['Status'] || ''),
  }))
  const matches = matchIncomingAppointments(incoming, [...existingById.values()].map((a) => ({
    id: a.id,
    patientId: a.patient_id,
    clinicId: a.clinic_id,
    externalReference: a.external_reference,
    startsAt: a.starts_at,
    endsAt: a.ends_at,
    status: a.status,
  })), refsInFile, targetClinicId.value, clinic?.timezone)

  for (const { index, row, extRef, patientId, start, end } of parsed) {
    const match = matches.get(index)!
    if (match.kind === 'held') {
      heldRows.push({ sourceRow: index + 2, ref: extRef, patientRef: row['Patient Number']?.trim() || '', label: start.toLocaleString(), reason: match.reason })
      continue
    }
    const existing = match.kind === 'insert' ? undefined : existingById.get(match.existingId)

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
      continue
    }

    matchedIds.push(existing.id)
    const incomingFields: AppointmentOverwritable = {
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      status: mapStatus(row['Status'] || ''),
      practitioner_id: (practName && practitionerMap.value[practName]) || null,
      practitioner_name: practName || null,
      appointment_type_id: (typeName && typeMap.value[typeName]) || null,
    }
    let { updates: fieldUpdates, diff } = buildAppointmentUpdate(existing, incomingFields)
    const keptReason = quiroflowKeeps(
      { status: existing.status, rescheduled: existing.rescheduled, checkedInAt: existing.checked_in_at },
      diff.map((d) => d.field),
    )
    if (keptReason) {
      keptRows.push({
        sourceRow: index + 2,
        ref: extRef,
        here: `${new Date(existing.starts_at).toLocaleString()} · ${statusLabel(existing.status)}`,
        practiceHub: `${start.toLocaleString()} · ${statusLabel(incomingFields.status!)}`,
        reason: keptReason,
      })
      fieldUpdates = {}
      diff = []
    }
    // An adopted visit still takes the new id when its fields are kept, so
    // the next run and the ledger import find it.
    const adopted = match.kind === 'adopt'
    if (adopted) {
      fieldUpdates.external_reference = extRef
      diff.unshift({ field: 'external_reference', from: formatValue(existing.external_reference), to: extRef })
    }
    if (Object.keys(fieldUpdates).length === 0) {
      if (!keptReason) skippedDuplicate.value++
      continue
    }
    updates.push({
      id: existing.id,
      label: start.toLocaleString(),
      adopted,
      updates: fieldUpdates,
      diff,
      note,
      sourceRow: index + 2,
    })
  }

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
  held.value = heldRows
  kept.value = keptRows
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
    showToast(
      t(
        `Imported ${importedCount.value} appointments. Updated ${updatedCount.value} existing appointments.`,
        `Se importaron ${importedCount.value} citas. Se actualizaron ${updatedCount.value} citas existentes.`,
      ),
      importErrors.value.length > 0 ? 'error' : 'success',
    )
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
  held.value = []
  kept.value = []
  importedCount.value = 0
  updatedCount.value = 0
  importErrors.value = []
}
const introLead = computed(() => t('Brings past and upcoming visits across from a PracticeHub CSV export, matched to the patient each one belongs to.', 'Trae las visitas pasadas y futuras desde una exportación CSV de PracticeHub, emparejadas con el paciente al que pertenecen.'))
const introNotes = computed(() => [
        { title: t('Run Patients first.', 'Ejecuta Pacientes primero.'), body: t('A visit whose patient has no PracticeHub reference here cannot be matched and is skipped.', 'Una visita cuyo paciente no tenga referencia de PracticeHub aquí no se puede emparejar y se omite.') },
        { title: t('Where the file comes from.', 'De dónde sale el archivo.'), body: t('Export "Appointments" as CSV from PracticeHub under Settings -> Data Exports, then drop it here.', 'Exporta "Appointments" como CSV desde PracticeHub en Settings -> Data Exports y suéltalo aquí.') },
        { title: t('Safe to run again.', 'Se puede volver a ejecutar.'), body: t('A re-run updates a visit that changed in PracticeHub rather than adding a second one.', 'Volver a ejecutarlo actualiza una visita que cambió en PracticeHub en lugar de añadir otra.') },
        { title: t('QuiroFlow wins once you use it.', 'QuiroFlow manda en cuanto lo usas.'), body: t('A visit moved in QuiroFlow, or already checked in, completed, missed or cancelled here, keeps its QuiroFlow version. The preview lists what PracticeHub has for it instead of changing it.', 'Una visita movida en QuiroFlow, o ya registrada, completada, no presentada o cancelada aquí, conserva su versión de QuiroFlow. La vista previa muestra lo que tiene PracticeHub en lugar de cambiarla.') },
        { title: t('Re-created in PracticeHub.', 'Recreadas en PracticeHub.'), body: t('An appointment deleted and re-created in PracticeHub gets a new id. When the patient has one visit here that day, that visit takes the new id instead of a second one arriving; when that is not certain, the row is held back and listed for you to check.', 'Una cita borrada y recreada en PracticeHub recibe un id nuevo. Si el paciente tiene una visita aquí ese día, esa visita toma el id nuevo en lugar de llegar una segunda; si no es seguro, la fila se aparta y se lista para que la revises.') },
])

function statusLabel(status: string): string {
  switch (status) {
    case 'completed':
      return t('completed', 'completada')
    case 'cancelled':
      return t('cancelled', 'cancelada')
    case 'no_show':
      return t('no-show', 'no presentado')
    default:
      return t('booked', 'reservada')
  }
}

function keptReasonLabel(reason: KeptReason): string {
  switch (reason) {
    case 'moved_here':
      return t('Moved in QuiroFlow', 'Movida en QuiroFlow')
    case 'outcome_here':
      return t('Already checked in, completed, missed or cancelled here', 'Ya registrada, completada, no presentada o cancelada aquí')
  }
}

function heldReasonLabel(reason: HeldReason): string {
  switch (reason) {
    case 'several':
      return t('Several visits here that day could be this one', 'Varias visitas de ese día podrían ser esta')
    case 'contested':
      return t('Another row in the file matches the same visit', 'Otra fila del archivo coincide con la misma visita')
    case 'moved_away':
      return t("PracticeHub moved this visit's id to another day or patient and re-created the visit", 'PracticeHub movió el id de esta visita a otro día o paciente y recreó la visita')
  }
}
</script>

<template>
  <div>
    <ImportIntro :lead="introLead" :notes="introNotes" />

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
              'Match each imported practitioner name to a real team member, or keep it as a label only (no login yet, so you can still see who saw the patient — invite them properly from Settings → Team later).',
              'Empareja cada nombre de profesional importado con un miembro real del equipo, o déjalo solo como etiqueta (sin acceso todavía, para que puedas seguir viendo quién atendió al paciente; invítalo correctamente desde Ajustes → Equipo más adelante).',
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
        <dl class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><dt class="text-ink-muted2">{{ t('Total rows', 'Filas totales') }}</dt><dd class="font-medium text-ink-900">{{ totalRows }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Will import', 'Se importarán') }}</dt><dd class="font-medium text-success-text">{{ toImport.length }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Will update', 'Se actualizarán') }}</dt><dd class="font-medium text-brand-text">{{ toUpdate.length }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Re-created in PracticeHub, already here', 'Recreadas en PracticeHub, ya aquí') }}</dt><dd class="font-medium text-brand-text">{{ adoptedCount }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('QuiroFlow version kept', 'Se conserva la versión de QuiroFlow') }}</dt><dd class="font-medium text-ink-900">{{ kept.length }}</dd></div>
          <div><dt class="text-ink-muted2">{{ t('Held for review', 'Apartadas para revisar') }}</dt><dd class="font-medium" :class="held.length > 0 ? 'text-danger-text' : 'text-ink-900'">{{ held.length }}</dd></div>
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

      <div v-if="kept.length > 0" class="overflow-hidden rounded-lg border border-line bg-surface">
        <div class="border-b border-line-divider px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted2">
          {{ t('QuiroFlow version kept -- PracticeHub differs, nothing is changed', 'Se conserva la versión de QuiroFlow: PracticeHub difiere, no se cambia nada') }}
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="border-b border-line bg-surface-subtle text-left text-xs font-medium uppercase tracking-wide text-ink-muted2">
              <tr>
                <th class="px-3 py-2">{{ t('PracticeHub id', 'Id de PracticeHub') }}</th>
                <th class="px-3 py-2">{{ t('In QuiroFlow', 'En QuiroFlow') }}</th>
                <th class="px-3 py-2">{{ t('In PracticeHub', 'En PracticeHub') }}</th>
                <th class="px-3 py-2">{{ t('Why', 'Motivo') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-divider">
              <tr v-for="row in kept" :key="row.sourceRow">
                <td class="px-3 py-2 text-ink-muted2">{{ row.ref || t('N/A', 'N/D') }}</td>
                <td class="px-3 py-2 text-ink-900">{{ row.here }}</td>
                <td class="px-3 py-2 text-ink-muted2">{{ row.practiceHub }}</td>
                <td class="px-3 py-2 text-ink-muted2">{{ keptReasonLabel(row.reason) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="held.length > 0" class="overflow-hidden rounded-lg border border-line bg-surface">
        <div class="border-b border-line-divider px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted2">
          {{ t('Held for review -- not imported and not changed', 'Apartadas para revisar: ni se importan ni se cambian') }}
        </div>
        <table class="w-full text-sm">
          <thead class="border-b border-line bg-surface-subtle text-left text-xs font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('Date', 'Fecha') }}</th>
              <th class="px-3 py-2">{{ t('PracticeHub id', 'Id de PracticeHub') }}</th>
              <th class="px-3 py-2">{{ t('Patient number', 'Nº de paciente') }}</th>
              <th class="px-3 py-2">{{ t('Why', 'Motivo') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-for="row in held" :key="row.sourceRow">
              <td class="px-3 py-2 text-ink-900">{{ row.label }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.ref || t('N/A', 'N/D') }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ row.patientRef || t('N/A', 'N/D') }}</td>
              <td class="px-3 py-2 text-ink-muted2">{{ heldReasonLabel(row.reason) }}</td>
            </tr>
          </tbody>
        </table>
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
