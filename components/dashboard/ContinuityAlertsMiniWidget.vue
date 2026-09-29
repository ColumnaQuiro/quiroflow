<script setup lang="ts">
// KPI: how many patients on an active care plan have fallen behind their
// own plan's cadence -- backed by care_plan_continuity_alerts, same shape
// as RecallsDueMiniWidget.vue but plan-aware instead of a flat threshold.
const props = defineProps<{ practitionerId?: string }>()

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const count = ref(0)
const avgDays = ref<number | null>(null)
const latest = useLatestRun()

async function load() {
  const isStale = latest.start()
  loading.value = true
  // Counted and summed in the database; only the average's rounding is done
  // here, so a half-day rounds exactly as it did when every row came across.
  const { data, error } = await supabase.rpc('dashboard_continuity_summary', { p_practitioner_id: props.practitionerId || null }).single()
  if (isStale()) return
  if (error) throw error
  count.value = data.patient_count
  avgDays.value = data.days_known > 0 ? Math.round(data.days_sum / data.days_known) : null
  loading.value = false
}
onMounted(load)
watch(() => props.practitionerId, load)
</script>

<template>
  <div v-if="loading" class="space-y-1.5">
    <UiSkeleton class="h-[27px] w-10 rounded-ctlSm" />
    <UiSkeleton class="h-3 w-44 rounded-ctlSm" />
  </div>
  <div v-else>
    <p class="font-mono text-[27px] leading-none text-ink-900">{{ count }}</p>
    <p class="mt-1.5 text-[12px] text-ink-muted2">
      {{ avgDays !== null ? t(`Avg ${avgDays} days behind plan`, `Media de ${avgDays} días de retraso`) : t('No care plans behind schedule', 'Ningún plan de tratamiento retrasado') }}
    </p>
    <NuxtLink to="/care-plan-alerts" class="mt-1.5 inline-block text-[12px] font-medium text-brand-text hover:text-brand-hover">{{ t('View alerts →', 'Ver alertas →') }}</NuxtLink>
  </div>
</template>
