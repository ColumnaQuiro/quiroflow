<script setup lang="ts">
import type { ShallowRef } from 'vue'
import { planCarePlans } from '~/utils/practicehubImport/carePlans'
import type { PracticeHubPlan } from '~/utils/practicehubImport/types'

// Care plans, one step at a time. It plans with exactly the code the server's
// "Sync everything" runs (planCarePlans, utils/practicehubImport/carePlans.ts):
// each PracticeHub plan becomes a care plan with its phases and re-exam
// visits, and one imported earlier as a note in the contact history is moved
// there. This screen only reads PracticeHub itself, shows the plan, and
// applies it.
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const stage = ref<'connect' | 'scanning' | 'preview' | 'importing' | 'done' | 'error'>('connect')
useImportWriting(() => stage.value === 'importing')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

// shallowRef: the plan carries its own apply(), not state to make reactive.
const plan: ShallowRef<PracticeHubPlan | null> = shallowRef(null)
const importedCount = ref(0)
const importErrors = ref<string[]>([])

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'scanning'
  runError.value = ''
  plan.value = null
  importedCount.value = 0
  importErrors.value = []
  const api = usePracticeHubApi(conn)

  try {
    phase.value = t('Matching patients…', 'Emparejando pacientes…')
    const patients = await api.fetchAll<{ id: number; patient_number: string }>('/patients', (done, total) => (progress.value = { done, total }))
    phase.value = t('Fetching care plans…', 'Obteniendo planes de cuidados…')
    progress.value = { done: 0, total: 0 }
    const plans = await api.fetchAll('/care_plans', (done, total) => (progress.value = { done, total }))
    // Only for the names of re-exam visits' appointment types.
    const types = await api.fetchAll('/appointment_types')
    plan.value = await planCarePlans(
      { supabase: supabase as never, accountId: store.accountId!, clinicId: store.currentClinicId ?? null, defaultPhoneCountry: store.defaultPhoneCountry, t, files: null },
      { readAt: new Date().toISOString(), baseUrl: conn.baseUrl, lists: { '/patients': patients, '/care_plans': plans, '/appointment_types': types } },
    )
    stage.value = 'preview'
  } catch (err) {
    runError.value = importErrorText(err, t, { en: 'Could not read PracticeHub. Nothing was written; try again.', es: 'No se pudo leer PracticeHub. No se escribió nada; vuelve a intentarlo.' })
    stage.value = 'error'
  }
}

async function apply() {
  const p = plan.value
  if (!p) return
  stage.value = 'importing'
  progress.value = { done: 0, total: p.total }
  try {
    const res = await p.apply((done) => (progress.value = { done, total: p.total }), () => false)
    importedCount.value = res.written
    importErrors.value = res.errors
  } catch (err) {
    // Re-running is safe: a plan already here is skipped on the next scan,
    // so surfacing the error beats a stuck "Importing…".
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
    return
  }
  stage.value = 'done'
  showToast(
    t(`Saved ${importedCount.value} care plans.`, `Se guardaron ${importedCount.value} planes de cuidados.`),
    importErrors.value.length > 0 ? 'error' : 'success',
  )
}

function retryRun() {
  if (lastConn.value) run(lastConn.value)
}

function reset() {
  stage.value = 'connect'
  plan.value = null
  importedCount.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: 0 }
}
const introLead = computed(() => t("Brings each patient's care plan across from PracticeHub's API as a care plan here: its phases (\"2 a week for 3 weeks, then 1 a week for 9\") and its re-exam visits. Plans imported earlier as a note in the patient's history are moved.", 'Trae el plan de cuidados de cada paciente desde la API de PracticeHub como un plan de cuidados aquí: sus fases ("2 por semana durante 3 semanas, luego 1 por semana durante 9") y sus visitas de revisión. Los planes importados antes como nota en el historial del paciente se mueven.'))
const introNotes = computed(() => [
  { title: t('Run Patients and Appointment types first.', 'Ejecuta antes Pacientes y Tipos de cita.'), body: t('Each plan is matched to its patient by their PracticeHub reference, and a re-exam visit to the appointment type of the same name. A plan switched off in PracticeHub stays a note in the patient\'s history.', 'Cada plan se empareja con su paciente por su referencia de PracticeHub, y cada visita de revisión con el tipo de cita del mismo nombre. Un plan desactivado en PracticeHub se queda como nota en el historial del paciente.') },
  { title: t('Nothing is written until you confirm.', 'No se escribe nada hasta que lo confirmes.'), body: t('The preview lists every plan and what it becomes, so you can check it first.', 'La vista previa muestra cada plan y en qué se convierte, para que lo compruebes antes.') },
  { title: t('Safe to run again.', 'Se puede volver a ejecutar.'), body: t('Plans already here are skipped, and kept as the clinic has them.', 'Los planes que ya están aquí se omiten, y se quedan como los tenga la clínica.') },
])
</script>

<template>
  <div>
    <ImportIntro :lead="introLead" :notes="introNotes" />

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'scanning' || stage === 'importing'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ stage === 'importing' ? t('Importing…', 'Importando…') : phase }}</p>
      <p v-if="progress.total > 0" class="mt-1 text-xs text-ink-faint">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <div v-else-if="stage === 'preview'" class="mt-4 space-y-4">
      <ul v-if="plan?.warnings.length" class="space-y-1 rounded-ctl border border-warning-border bg-warning-bg p-3 text-[13px] text-warning-text" data-cy="ph-care-plans-warnings">
        <li v-for="(w, i) in plan.warnings" :key="i">{{ w }}</li>
      </ul>
      <ImportPreviewPanel
        :stats="plan?.stats ?? []"
        :columns="plan?.columns ?? []"
        :rows="plan?.rows ?? []"
        :apply-disabled="!plan?.total"
        :apply-label="t('Save the care plans', 'Guardar los planes')"
        :more-label="t('more care plans', 'planes más')"
        @apply="apply"
        @cancel="reset"
      />
    </div>

    <div v-else-if="stage === 'error'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('The import stopped before it finished.', 'La importación se detuvo antes de terminar.') }}</p>
        <p class="mt-1">{{ t('Anything already written is kept. Retry reads PracticeHub again and skips it.', 'Lo ya escrito se conserva. Reintentar vuelve a leer PracticeHub y lo omite.') }}</p>
        <p class="mt-1 text-[12.5px] opacity-80">{{ runError }}</p>
      </div>
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover" @click="retryRun">
        {{ t('Retry', 'Reintentar') }}
      </button>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-4">
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
          {{ t('Run again', 'Ejecutar de nuevo') }}
        </button>
      </div>
    </div>
  </div>
</template>
