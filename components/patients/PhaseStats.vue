<script setup lang="ts">
const props = withDefaults(defineProps<{ patientId: string; editable?: boolean }>(), { editable: true })

interface CarePlan {
  id: string
  name: string
  frequency_value: number
  frequency_unit: 'week' | 'month'
  visits_per_period?: number | null
  payment_kind?: string | null
  package_purchase_id?: string | null
  patient_membership_id?: string | null
  total_visits: number
  started_at: string
}

const supabase = useSupabaseClient()
const t = useT()

const loading = ref(true)
const plan = ref<CarePlan | null>(null)
const completedInPlan = ref(0)
const scheduledInPlan = ref(0)
const editOpen = ref(false)

const remaining = computed(() => {
  if (!plan.value) return 0
  return Math.max(0, plan.value.total_visits - completedInPlan.value)
})
const progressPct = computed(() => {
  if (!plan.value || plan.value.total_visits === 0) return 0
  return Math.min(100, Math.round((completedInPlan.value / plan.value.total_visits) * 100))
})
const frequencyLabel = computed(() => (plan.value ? carePlanCadenceLabel(plan.value, t) : ''))

async function load() {
  loading.value = true
  const [{ data: appts }, { data: plans }] = await Promise.all([
    supabase.from('appointments').select('status, starts_at').eq('patient_id', props.patientId).is('deleted_at', null),
    supabase
      .from('care_plans')
      .select('id, name, frequency_value, frequency_unit, visits_per_period, total_visits, started_at, payment_kind, package_purchase_id, patient_membership_id')
      .eq('patient_id', props.patientId)
      .order('created_at', { ascending: false })
      .limit(1),
  ])

  plan.value = (plans as CarePlan[] | null)?.[0] ?? null

  if (plan.value) {
    const startedAt = plan.value.started_at
    const inPlan = (appts ?? []).filter((a) => a.starts_at >= startedAt)
    completedInPlan.value = inPlan.filter((a) => a.status === 'completed').length
    scheduledInPlan.value = inPlan.filter((a) => a.status === 'booked').length
  } else {
    completedInPlan.value = 0
    scheduledInPlan.value = 0
  }

  loading.value = false
}
onMounted(load)
watch(() => props.patientId, load)

// Visits the plan still needs that have no appointment yet -- what
// "Reservar las visitas del plan" books (the calendar panel's own count).
const toBook = computed(() => (plan.value ? Math.max(0, plan.value.total_visits - completedInPlan.value - scheduledInPlan.value) : 0))
// Just saved a plan: offer to book it, the step after creating one.
const justSaved = ref(false)

async function onPlanSaved() {
  editOpen.value = false
  await load()
  justSaved.value = true
}
function bookPlan() {
  navigateTo({ path: '/calendar', query: { patient: props.patientId, repeat: 'plan' } })
}
</script>

<template>
  <div class="rounded-card border border-line bg-surface p-4 shadow-card">
    <div v-if="loading" class="space-y-2">
      <UiSkeleton class="h-3.5 w-32 rounded-ctlSm" />
      <UiSkeleton class="h-3 w-40 rounded-ctlSm" />
      <UiSkeleton class="h-[6px] w-full rounded-full" />
    </div>
    <template v-else>
      <div class="flex items-center justify-between gap-2">
        <p class="truncate text-[13.5px] font-semibold text-ink-700">{{ plan ? plan.name : t('No care plan', 'Sin plan de tratamiento') }}</p>
        <button v-if="editable" type="button" class="shrink-0 text-[12px] font-medium text-brand-text hover:text-brand-hover" data-cy="care-plan-edit" @click="editOpen = true">
          {{ plan ? t('Edit', 'Editar') : t('+ Add plan', '+ Añadir plan') }}
        </button>
      </div>

      <template v-if="plan">
        <p class="mt-0.5 text-[12px] text-ink-muted2" data-cy="care-plan-summary">
          {{ completedInPlan }} {{ t('of', 'de') }} {{ plan.total_visits }} {{ t('visits', 'visitas') }} &middot; {{ frequencyLabel }}
        </p>

        <div class="mt-2.5 h-[6px] w-full overflow-hidden rounded-full bg-line-faint">
          <div class="h-full rounded-full bg-brand" :style="{ width: `${progressPct}%` }" />
        </div>

        <p class="mt-2 text-[12px] text-ink-muted2">
          <span class="font-medium text-ink-600">{{ completedInPlan }} {{ t('completed', 'completadas') }}</span> / {{ remaining }} {{ t('remaining', 'restantes') }}
        </p>
        <PatientsPlanPayment :plan="plan" :visits-left="remaining" />
      </template>
      <p v-else class="mt-1 text-[12.5px] text-ink-faint">{{ t('No plan set up for this patient yet.', 'Aún no se ha configurado un plan para este paciente.') }}</p>

      <div v-if="plan && editable && toBook > 0" class="mt-2.5 rounded-ctl px-3 py-2" :class="justSaved ? 'bg-brand-tint' : 'bg-surface-subtle'" data-cy="care-plan-book">
        <p v-if="justSaved" class="text-[12.5px] font-medium text-ink-900">{{ t('Plan saved. Book its visits now?', 'Plan guardado. ¿Reservas ya sus visitas?') }}</p>
        <button type="button" class="text-[12.5px] font-semibold text-brand-text hover:underline" data-cy="care-plan-book-open" @click="bookPlan">
          {{ toBook === 1 ? t('Book the 1 visit left →', 'Reservar la visita que falta →') : t(`Book the ${toBook} visits left →`, `Reservar las ${toBook} visitas que faltan →`) }}
        </button>
      </div>
    </template>

    <PatientsEditCarePlanModal v-if="editOpen" :patient-id="patientId" :plan="plan" @close="editOpen = false" @saved="onPlanSaved" />
  </div>
</template>
