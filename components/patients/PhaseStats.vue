<script setup lang="ts">
const props = defineProps<{ patientId: string }>()

interface CarePlan {
  id: string
  name: string
  frequency_value: number
  frequency_unit: 'week' | 'month'
  total_visits: number
  started_at: string
}

const supabase = useSupabaseClient()

const loading = ref(true)
const counts = ref({ completed: 0, cancelled: 0, no_show: 0, booked: 0 })
const plan = ref<CarePlan | null>(null)
const completedInPlan = ref(0)
const scheduledInPlan = ref(0)
const nextVisit = ref<string | null>(null)
const editOpen = ref(false)

// Show rate mirrors PracticeHub's "show percentage" -- of visits that were
// due to happen (completed or missed), how many the patient actually
// attended. A cancellation made ahead of time isn't counted against it.
const showPercentage = computed(() => {
  const denom = counts.value.completed + counts.value.no_show
  if (denom === 0) return null
  return Math.round((counts.value.completed / denom) * 100)
})

const unscheduledInPlan = computed(() => {
  if (!plan.value) return 0
  return Math.max(0, plan.value.total_visits - completedInPlan.value - scheduledInPlan.value)
})

async function load() {
  loading.value = true
  const [{ data: appts }, { data: plans }] = await Promise.all([
    supabase.from('appointments').select('status, starts_at').eq('patient_id', props.patientId),
    supabase
      .from('care_plans')
      .select('id, name, frequency_value, frequency_unit, total_visits, started_at')
      .eq('patient_id', props.patientId)
      .order('created_at', { ascending: false })
      .limit(1),
  ])

  const nextCounts = { completed: 0, cancelled: 0, no_show: 0, booked: 0 }
  for (const a of appts ?? []) {
    if (a.status in nextCounts) (nextCounts as Record<string, number>)[a.status]++
  }
  counts.value = nextCounts

  plan.value = (plans as CarePlan[] | null)?.[0] ?? null

  if (plan.value) {
    const startedAt = plan.value.started_at
    const nowIso = new Date().toISOString()
    const inPlan = (appts ?? []).filter((a) => a.starts_at >= startedAt)
    completedInPlan.value = inPlan.filter((a) => a.status === 'completed').length
    scheduledInPlan.value = inPlan.filter((a) => a.status === 'booked').length
    const futureBooked = inPlan
      .filter((a) => a.status === 'booked' && a.starts_at > nowIso)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    nextVisit.value = futureBooked[0]?.starts_at ?? null
  } else {
    completedInPlan.value = 0
    scheduledInPlan.value = 0
    nextVisit.value = null
  }

  loading.value = false
}
onMounted(load)
watch(() => props.patientId, load)

async function onPlanSaved() {
  editOpen.value = false
  await load()
}
</script>

<template>
  <div class="mb-4 rounded-lg border border-gray-200 bg-white p-4">
    <div v-if="loading" class="text-sm text-gray-400">Loading…</div>
    <template v-else>
      <div class="flex flex-wrap items-center gap-6">
        <div class="text-center">
          <p class="text-lg font-semibold text-green-600">{{ counts.completed }}</p>
          <p class="text-xs text-gray-400">Completed</p>
        </div>
        <div class="text-center">
          <p class="text-lg font-semibold text-amber-600">{{ counts.cancelled }}</p>
          <p class="text-xs text-gray-400">Cancelled</p>
        </div>
        <div class="text-center">
          <p class="text-lg font-semibold text-red-600">{{ counts.no_show }}</p>
          <p class="text-xs text-gray-400">Missed</p>
        </div>
        <div class="text-center">
          <p class="text-lg font-semibold text-gray-900">{{ showPercentage === null ? '—' : `${showPercentage}%` }}</p>
          <p class="text-xs text-gray-400">Show rate</p>
        </div>
      </div>

      <div class="mt-4 border-t border-gray-100 pt-4">
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold text-gray-900">{{ plan ? plan.name : 'No care plan' }}</p>
          <button type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-500" @click="editOpen = true">
            {{ plan ? 'Edit Plan' : '+ Add Plan' }}
          </button>
        </div>
        <template v-if="plan">
          <p class="mt-1 text-xs text-gray-500">
            {{ plan.frequency_value }} visit{{ plan.frequency_value > 1 ? 's' : '' }} every {{ plan.frequency_unit }}
            &middot; {{ plan.total_visits }} visits total &middot; started {{ new Date(plan.started_at).toLocaleDateString() }}
          </p>
          <div class="mt-2 flex flex-wrap gap-1">
            <span
              v-for="i in plan.total_visits"
              :key="i"
              class="h-2.5 w-2.5 rounded-full"
              :class="i <= completedInPlan ? 'bg-green-500' : i <= completedInPlan + scheduledInPlan ? 'bg-indigo-300' : 'bg-gray-200'"
              :title="i <= completedInPlan ? 'Completed' : i <= completedInPlan + scheduledInPlan ? 'Scheduled' : 'Unscheduled'"
            ></span>
          </div>
          <p class="mt-2 text-xs text-gray-500">
            <span v-if="nextVisit">
              Next visit in phase: {{ new Date(nextVisit).toLocaleDateString() }} (visit {{ completedInPlan + 1 }} of {{ plan.total_visits }})
            </span>
            <span v-else-if="completedInPlan + scheduledInPlan >= plan.total_visits">Plan complete.</span>
            <span v-else>No upcoming visit scheduled &mdash; {{ unscheduledInPlan }} left to book.</span>
          </p>
        </template>
      </div>
    </template>

    <PatientsEditCarePlanModal v-if="editOpen" :patient-id="patientId" :plan="plan" @close="editOpen = false" @saved="onPlanSaved" />
  </div>
</template>
