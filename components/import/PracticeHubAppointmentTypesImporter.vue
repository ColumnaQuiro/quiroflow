<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

interface PHAppointmentType { id: number; name: string; active?: number | boolean | null; duration?: number | null; color?: string | null }
interface PHAppointment { id: number; appointment_type_id: number | null }

// Best-effort mapping from PracticeHub's own type names to the Statistics
// report's funnel stages -- only the unambiguous ones. Routine adjustment
// visits and anything else stay unstaged; staff can tag those manually
// under Settings > Appointment Types same as always.
const STAGE_BY_NAME: Record<string, string> = {
  'primera visita': 'first_visit',
  'oferta primera visita': 'first_visit_offer',
  'informe quiropractico': 'report',
  'revisión quiropractica': 'revision',
  'revision quiropractica': 'revision',
  'mantenimiento quiropractico': 'maintenance',
}

interface TypeCandidate {
  phTypeId: number
  name: string
  /** Set when a type of the same name is already here; null means it gets created. */
  ourTypeId: string | null
  funnelStage: string | null
  /** PracticeHub's appointments of this type that are already here, by reference. */
  appointmentRefs: string[]
  /** All of PracticeHub's appointments of this type, here or not. */
  inPracticeHub: number
  durationMinutes: number | null
  color: string | null
  /** Retired in PracticeHub but still on old visits: created archived, never offered. */
  archived: boolean
}

// PracticeHub keeps retired types, often a near-duplicate of a live one
// ("Primera Visita" beside "Primera visita"). One that is retired AND was
// never used is not brought across: on Columnaquiro that was five of fourteen,
// and a new clinic's type list started out with them.
function isWorthBringing(phType: PHAppointmentType, used: number) {
  return used > 0 || !(phType.active === 0 || phType.active === false)
}

function hexColor(value: string | null | undefined): string | null {
  const hex = (value ?? '').trim().replace(/^#/, '')
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null
}

const stage = ref<'connect' | 'scanning' | 'preview' | 'importing' | 'done' | 'error'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

const candidates = ref<TypeCandidate[]>([])
const skippedNoMatch = ref(0)

const typesCreated = ref(0)
const appointmentsUpdated = ref(0)
const importErrors = ref<string[]>([])

const newTypeCount = computed(() => new Set(candidates.value.filter((c) => !c.ourTypeId).map((c) => c.name.trim().toLowerCase())).size)
const appointmentsToRelink = computed(() => candidates.value.reduce((sum, c) => sum + c.appointmentRefs.length, 0))

const previewColumns = computed(() => [
  { key: 'name', label: t('Appointment type', 'Tipo de cita') },
  { key: 'status', label: t('Status', 'Estado') },
  { key: 'funnelStage', label: t('Funnel stage', 'Etapa del embudo') },
  { key: 'appointments', label: t('Appointments', 'Citas') },
])

const previewRows = computed(() =>
  [...candidates.value]
    .sort((a, b) => b.inPracticeHub - a.inPracticeHub)
    .map((c) => ({
      name: c.name,
      status: c.ourTypeId ? t('Already here', 'Ya existe') : t('Will be created', 'Se creará'),
      funnelStage: c.funnelStage ?? t('—', '—'),
      appointments: String(c.inPracticeHub),
    })),
)

const previewStats = computed(() => [
  { label: t('New types', 'Tipos nuevos'), value: newTypeCount.value, tone: 'good' as const },
  { label: t('Appointments to relink', 'Citas a revincular'), value: appointmentsToRelink.value, tone: 'good' as const },
  { label: t('Types already here', 'Tipos ya existentes'), value: candidates.value.length - newTypeCount.value },
  { label: t('No type in PracticeHub', 'Sin tipo en PracticeHub'), value: skippedNoMatch.value },
])

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'scanning'
  runError.value = ''
  candidates.value = []
  skippedNoMatch.value = 0
  typesCreated.value = 0
  appointmentsUpdated.value = 0
  importErrors.value = []
  const api = usePracticeHubApi(conn)

  try {
    phase.value = t('Fetching appointment types…', 'Obteniendo tipos de cita…')
    const phTypes = await api.fetchAll<PHAppointmentType>('/appointment_types')

    phase.value = t('Matching to existing types…', 'Emparejando con los tipos existentes…')
    const { data: existing } = await supabase.from('appointment_types').select('id, name')
    const existingByName = new Map((existing ?? []).map((row) => [row.name.trim().toLowerCase(), row.id]))

    // Only the visits already here can be re-pointed. Counting PracticeHub's
    // own told a clinic with no appointments yet that 8,695 would be relinked.
    const refsHere = new Set<string>()
    const PAGE_SIZE = 1000
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('appointments')
        .select('external_reference')
        .not('external_reference', 'is', null)
        .order('id')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const a of data ?? []) refsHere.add(a.external_reference!)
      if (!data || data.length < PAGE_SIZE) break
    }

    phase.value = t('Fetching appointments…', 'Obteniendo citas…')
    progress.value = { done: 0, total: 0 }
    const phAppointments = await api.fetchAll<PHAppointment>('/appointments', (done, total) => (progress.value = { done, total }))

    const refsByPhTypeId = new Map<number, string[]>()
    const knownPhTypeIds = new Set(phTypes.map((phType) => phType.id))
    for (const appt of phAppointments) {
      if (!appt.appointment_type_id || !knownPhTypeIds.has(appt.appointment_type_id)) {
        skippedNoMatch.value++
        continue
      }
      const list = refsByPhTypeId.get(appt.appointment_type_id) ?? []
      list.push(String(appt.id))
      refsByPhTypeId.set(appt.appointment_type_id, list)
    }

    candidates.value = phTypes
      .filter((phType) => isWorthBringing(phType, refsByPhTypeId.get(phType.id)?.length ?? 0))
      .map((phType) => {
        const key = phType.name.trim().toLowerCase()
        const refs = refsByPhTypeId.get(phType.id) ?? []
        return {
          phTypeId: phType.id,
          name: phType.name,
          ourTypeId: existingByName.get(key) ?? null,
          funnelStage: STAGE_BY_NAME[key] ?? null,
          appointmentRefs: refs.filter((ref) => refsHere.has(ref)),
          inPracticeHub: refs.length,
          durationMinutes: phType.duration && phType.duration > 0 ? phType.duration : null,
          color: hexColor(phType.color),
          archived: phType.active === 0 || phType.active === false,
        }
      })
    stage.value = 'preview'
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
}

async function apply() {
  stage.value = 'importing'
  typesCreated.value = 0
  appointmentsUpdated.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: appointmentsToRelink.value }

  try {
    phase.value = t('Creating appointment types…', 'Creando tipos de cita…')
    const ourTypeIdByPhTypeId = new Map<number, string>()
    // Two PracticeHub types can share a name; the second reuses the first
    // rather than creating a twin.
    const createdByName = new Map<string, string>()
    for (const c of candidates.value) {
      const key = c.name.trim().toLowerCase()
      const known = c.ourTypeId ?? createdByName.get(key)
      if (known) {
        ourTypeIdByPhTypeId.set(c.phTypeId, known)
        continue
      }
      const { data: created, error } = await supabase
        .from('appointment_types')
        // Not bookable online: an imported type is the history's, and the
        // clinic decides which ones patients may book on the type's own page.
        // Its length and colour are PracticeHub's, so the calendar looks the
        // way the clinic is used to.
        .insert({
          account_id: store.accountId!,
          name: c.name,
          stage: c.funnelStage,
          online_booking_enabled: false,
          ...(c.durationMinutes ? { duration_minutes: c.durationMinutes } : {}),
          ...(c.color ? { color: c.color } : {}),
          ...(c.archived ? { archived_at: new Date().toISOString() } : {}),
        })
        .select('id')
        .single()
      if (error || !created) {
        importErrors.value.push(t(`Creating type "${c.name}": ${error?.message}`, `Creando tipo "${c.name}": ${error?.message}`))
        continue
      }
      ourTypeIdByPhTypeId.set(c.phTypeId, created.id)
      createdByName.set(key, created.id)
      typesCreated.value++
    }

    // Group by target type so each chunk is one bulk update instead of one
    // request per appointment -- 8000+ individual updates would be far too slow.
    phase.value = t('Relinking appointments…', 'Revinculando citas…')
    const CHUNK_SIZE = 200
    let done = 0
    for (const c of candidates.value) {
      const ourTypeId = ourTypeIdByPhTypeId.get(c.phTypeId)
      if (!ourTypeId) continue
      for (let i = 0; i < c.appointmentRefs.length; i += CHUNK_SIZE) {
        const chunk = c.appointmentRefs.slice(i, i + CHUNK_SIZE)
        const { error, count } = await supabase.from('appointments').update({ appointment_type_id: ourTypeId }, { count: 'exact' }).in('external_reference', chunk)
        if (error)
          importErrors.value.push(
            t(`Updating batch near ref ${chunk[0]}: ${error.message}`, `Actualizando lote cerca de la referencia ${chunk[0]}: ${error.message}`),
          )
        else appointmentsUpdated.value += count ?? 0
        done += chunk.length
        progress.value = { done, total: appointmentsToRelink.value }
      }
    }
  } catch (err) {
    // Re-running is safe -- types match by name and the appointment updates
    // are idempotent -- so surfacing the error beats a stuck "Importing…".
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
    return
  }

  stage.value = 'done'
  showToast(
    t(
      `Created ${typesCreated.value} new appointment type(s), updated ${appointmentsUpdated.value} appointments. Skipped ${skippedNoMatch.value} with no type in PracticeHub.`,
      `Se crearon ${typesCreated.value} tipo(s) de cita nuevos, se actualizaron ${appointmentsUpdated.value} citas. Se omitieron ${skippedNoMatch.value} sin tipo en PracticeHub.`,
    ),
    importErrors.value.length > 0 ? 'error' : 'success',
  )
}

function retryRun() {
  if (lastConn.value) run(lastConn.value)
}

function reset() {
  stage.value = 'connect'
  candidates.value = []
  typesCreated.value = 0
  appointmentsUpdated.value = 0
  skippedNoMatch.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: 0 }
}
const introLead = computed(() => t('Brings PracticeHub’s appointment types across, with their length and colour, and points every visit already here at the type PracticeHub says it was. Run it before Appointments, so their types match by name.', 'Trae los tipos de cita de PracticeHub, con su duración y color, y asocia cada visita que ya esté aquí al tipo que dice PracticeHub. Ejecútalo antes de Citas, para que sus tipos coincidan por nombre.'))
const introNotes = computed(() => [
        { title: t('Nothing is written until you press Apply.', 'No se escribe nada hasta que pulses Aplicar.'), body: t('The preview lists every visit it will re-point so you can check it first.', 'La vista previa muestra cada visita que reasignará para que la compruebes antes.') },
        { title: t('Safe to run again.', 'Se puede volver a ejecutar.'), body: t('Visits already on the right type are skipped.', 'Las visitas que ya tienen el tipo correcto se omiten.') },
])
</script>

<template>
  <div>
    <ImportIntro :lead="introLead" :notes="introNotes" />

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'scanning' || stage === 'importing'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ phase }}</p>
      <p v-if="progress.total > 0" class="mt-1 text-xs text-ink-faint">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <ImportPreviewPanel
      v-else-if="stage === 'preview'"
      class="mt-4"
      :stats="previewStats"
      :columns="previewColumns"
      :rows="previewRows"
      :sample-limit="20"
      :apply-label="
        t(
          `Create ${newTypeCount} type(s) and relink ${appointmentsToRelink} appointment(s)`,
          `Crear ${newTypeCount} tipo(s) y revincular ${appointmentsToRelink} cita(s)`,
        )
      "
      :more-label="t('more types', 'tipos más')"
      @apply="apply"
      @cancel="reset"
    >
      <template #note>
        <p class="text-xs text-ink-faint">
          {{
            t(
              'Types already here are matched by name and reused — only the ones marked "Will be created" are new. Relinking overwrites whatever type an appointment currently has here, treating PracticeHub as the source of truth.',
              'Los tipos que ya existen aquí se emparejan por nombre y se reutilizan: solo son nuevos los marcados como «Se creará». La revinculación sobrescribe el tipo que la cita tenga ahora aquí, tratando a PracticeHub como fuente de verdad.',
            )
          }}
        </p>
      </template>
    </ImportPreviewPanel>

    <div v-else-if="stage === 'error'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Import failed:', 'Error al importar:') }}</p>
        <p class="mt-1">{{ runError }}</p>
      </div>
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover" @click="retryRun">
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
        <NuxtLink to="/settings/appointment-types" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover">
          {{ t('Review Appointment Types', 'Revisar tipos de cita') }}
        </NuxtLink>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Run again', 'Ejecutar de nuevo') }}
        </button>
      </div>
    </div>
  </div>
</template>
