<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

interface PHCarePlan {
  id: number
  patient_id: number
  start_date: string
  active: number
  visits: number
  interval: string
  duration: number
  frequency_type: string
}

const stage = ref<'connect' | 'importing' | 'done'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })

const importedCount = ref(0)
const skippedDuplicate = ref(0)
const skippedUnmatched = ref(0)
const importErrors = ref<string[]>([])

function formatPlan(plan: PHCarePlan): string {
  return `${plan.visits} visit(s), every ${plan.interval}, for ${plan.duration} occurrence(s) (${plan.frequency_type}) starting ${plan.start_date}. ${plan.active ? 'Active.' : 'Inactive.'}`
}

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  stage.value = 'importing'
  const api = usePracticeHubApi(conn)

  phase.value = t('Matching patients…', 'Emparejando pacientes…')
  const phPatients = await api.fetchAll<{ id: number; patient_number: string }>('/patients', (done, total) => (progress.value = { done, total }))
  const patientNumberById = new Map(phPatients.map((p) => [p.id, p.patient_number]))

  const PAGE_SIZE = 1000
  const ourPatientByRef = new Map<string, string>()
  for (let page = 0; ; page++) {
    const { data } = await supabase.from('patients').select('id, external_reference').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const p of data ?? []) if (p.external_reference) ourPatientByRef.set(p.external_reference, p.id)
    if (!data || data.length < PAGE_SIZE) break
  }

  phase.value = t('Checking for already-imported plans…', 'Comprobando planes ya importados…')
  const existingRefs = new Set<string>()
  for (let page = 0; ; page++) {
    const { data } = await supabase
      .from('contact_log')
      .select('external_reference')
      .not('external_reference', 'is', null)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const c of data ?? []) if (c.external_reference) existingRefs.add(c.external_reference)
    if (!data || data.length < PAGE_SIZE) break
  }

  phase.value = t('Fetching care plans…', 'Obteniendo planes de cuidado…')
  progress.value = { done: 0, total: 0 }
  const plans = await api.fetchAll<PHCarePlan>('/care_plans', (done, total) => (progress.value = { done, total }))

  phase.value = t('Importing…', 'Importando…')
  const rows = []
  for (const plan of plans) {
    const ref = `PH-careplan-${plan.id}`
    if (existingRefs.has(ref)) {
      skippedDuplicate.value++
      continue
    }
    const patientNumber = patientNumberById.get(plan.patient_id)
    const patientId = patientNumber ? ourPatientByRef.get(patientNumber) : undefined
    if (!patientId) {
      skippedUnmatched.value++
      continue
    }
    rows.push({
      account_id: store.accountId!,
      patient_id: patientId,
      action: 'other',
      note: `[care_plan] ${formatPlan(plan)}`,
      external_reference: ref,
      created_at: plan.start_date,
    })
  }

  if (rows.length > 0) {
    const { error } = await supabase.from('contact_log').insert(rows)
    if (error) importErrors.value.push(error.message)
    else importedCount.value = rows.length
  }

  stage.value = 'done'
}

function reset() {
  stage.value = 'connect'
  importedCount.value = 0
  skippedDuplicate.value = 0
  skippedUnmatched.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: 0 }
}
</script>

<template>
  <div>
    <p class="text-sm text-gray-500">
      {{
        t(
          "Pulls care plans directly from PracticeHub's API into each patient's contact log here. Safe to re-run — already-imported plans are skipped.",
          'Obtiene los planes de cuidado directamente de la API de PracticeHub y los añade al registro de contacto de cada paciente. Se puede volver a ejecutar sin riesgo: los planes ya importados se omiten.',
        )
      }}
    </p>

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'importing'" class="mt-4 rounded-lg border border-gray-200 bg-white p-8 text-center">
      <p class="text-sm text-gray-600">{{ phase }}</p>
      <p v-if="progress.total > 0" class="mt-1 text-xs text-gray-400">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        {{
          t(
            `Imported ${importedCount} care plans. Skipped ${skippedDuplicate} already-imported, ${skippedUnmatched} with no matching patient.`,
            `Se importaron ${importedCount} planes de cuidado. Se omitieron ${skippedDuplicate} ya importados, ${skippedUnmatched} sin paciente coincidente.`,
          )
        }}
      </div>
      <div v-if="importErrors.length > 0" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p class="font-medium">{{ t('Some rows failed:', 'Algunas filas fallaron:') }}</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="(e, i) in importErrors" :key="i">{{ e }}</li>
        </ul>
      </div>
      <div class="flex gap-3">
        <NuxtLink to="/patients" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          {{ t('View Patients', 'Ver pacientes') }}
        </NuxtLink>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50" @click="reset">
          {{ t('Run again', 'Ejecutar de nuevo') }}
        </button>
      </div>
    </div>
  </div>
</template>
