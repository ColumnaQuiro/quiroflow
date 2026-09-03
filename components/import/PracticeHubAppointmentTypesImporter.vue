<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

interface PHAppointmentType { id: number; name: string }
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

const stage = ref<'connect' | 'importing' | 'done' | 'error'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

const typesCreated = ref(0)
const appointmentsUpdated = ref(0)
const skippedNoMatch = ref(0)
const importErrors = ref<string[]>([])

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'importing'
  runError.value = ''
  typesCreated.value = 0
  appointmentsUpdated.value = 0
  skippedNoMatch.value = 0
  importErrors.value = []
  const api = usePracticeHubApi(conn)

  try {
    phase.value = t('Fetching appointment types…', 'Obteniendo tipos de cita…')
    const phTypes = await api.fetchAll<PHAppointmentType>('/appointment_types')

    phase.value = t('Matching to existing types…', 'Emparejando con los tipos existentes…')
    const { data: existing } = await supabase.from('appointment_types').select('id, name')
    const existingByName = new Map((existing ?? []).map((t) => [t.name.trim().toLowerCase(), t.id]))

    const phIdToOurId = new Map<number, string>()
    for (const phType of phTypes) {
      const key = phType.name.trim().toLowerCase()
      let ourId = existingByName.get(key)
      if (!ourId) {
        const { data: created, error } = await supabase
          .from('appointment_types')
          .insert({
            account_id: store.accountId!,
            name: phType.name,
            stage: STAGE_BY_NAME[key] ?? null,
          })
          .select('id')
          .single()
        if (error || !created) {
          importErrors.value.push(
            t(`Creating type "${phType.name}": ${error?.message}`, `Creando tipo "${phType.name}": ${error?.message}`),
          )
          continue
        }
        ourId = created.id
        existingByName.set(key, ourId)
        typesCreated.value++
      }
      phIdToOurId.set(phType.id, ourId)
    }

    phase.value = t('Fetching appointments…', 'Obteniendo citas…')
    progress.value = { done: 0, total: 0 }
    const phAppointments = await api.fetchAll<PHAppointment>('/appointments', (done, total) => (progress.value = { done, total }))

    phase.value = t('Updating…', 'Actualizando…')
    progress.value = { done: 0, total: phAppointments.length }

    // Group by target type so each chunk is one bulk update instead of one
    // request per appointment -- 8000+ individual updates would be far too slow.
    const refsByOurTypeId = new Map<string, string[]>()
    for (const appt of phAppointments) {
      const ourTypeId = appt.appointment_type_id ? phIdToOurId.get(appt.appointment_type_id) : undefined
      if (!ourTypeId) {
        skippedNoMatch.value++
        continue
      }
      const list = refsByOurTypeId.get(ourTypeId) ?? []
      list.push(String(appt.id))
      refsByOurTypeId.set(ourTypeId, list)
    }

    const CHUNK_SIZE = 200
    let done = 0
    for (const [ourTypeId, refs] of refsByOurTypeId) {
      for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
        const chunk = refs.slice(i, i + CHUNK_SIZE)
        const { error } = await supabase
          .from('appointments')
          .update({ appointment_type_id: ourTypeId })
          .in('external_reference', chunk)
        if (error)
          importErrors.value.push(
            t(`Updating batch near ref ${chunk[0]}: ${error.message}`, `Actualizando lote cerca de la referencia ${chunk[0]}: ${error.message}`),
          )
        else appointmentsUpdated.value += chunk.length
        done += chunk.length
        progress.value = { done, total: phAppointments.length }
      }
    }

    stage.value = 'done'
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
}

function retryRun() {
  if (lastConn.value) run(lastConn.value)
}

function reset() {
  stage.value = 'connect'
  typesCreated.value = 0
  appointmentsUpdated.value = 0
  skippedNoMatch.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: 0 }
}
</script>

<template>
  <div>
    <p class="text-sm text-ink-muted2">
      {{
        t(
          "Pulls the real appointment types directly from PracticeHub's API and re-links every appointment to its actual type (matched by the internal appointment ID) — fixes reports like Statistics when the original CSV import only captured one type or none. Safe to re-run.",
          'Obtiene los tipos de cita reales directamente de la API de PracticeHub y vuelve a vincular cada cita con su tipo real (emparejado por el ID interno de la cita); esto corrige informes como Estadísticas cuando la importación original de CSV solo capturó un tipo o ninguno. Se puede volver a ejecutar sin riesgo.',
        )
      }}
    </p>

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'importing'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ phase }}</p>
      <p v-if="progress.total > 0" class="mt-1 text-xs text-ink-faint">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <div v-else-if="stage === 'error'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">Import failed:</p>
        <p class="mt-1">{{ runError }}</p>
      </div>
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover" @click="retryRun">
        Retry
      </button>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-success-border bg-success-bg p-4 text-sm text-success-text">
        {{
          t(
            `Created ${typesCreated} new appointment type(s), updated ${appointmentsUpdated} appointments. Skipped ${skippedNoMatch} with no type in PracticeHub.`,
            `Se crearon ${typesCreated} tipo(s) de cita nuevos, se actualizaron ${appointmentsUpdated} citas. Se omitieron ${skippedNoMatch} sin tipo en PracticeHub.`,
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
        <NuxtLink to="/settings/appointment-types" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">
          {{ t('Review Appointment Types', 'Revisar tipos de cita') }}
        </NuxtLink>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Run again', 'Ejecutar de nuevo') }}
        </button>
      </div>
    </div>
  </div>
</template>
