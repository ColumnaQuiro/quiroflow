<script setup lang="ts">
// KPI: how many patients are currently due for a recall, backed by the same
// recall_candidates view the Recalls page and sidebar badge use.
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
  const { data, error } = await supabase.rpc('dashboard_recall_summary', { p_practitioner_id: props.practitionerId || null }).single()
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
      {{ avgDays !== null ? t(`Avg ${avgDays} days since last visit`, `Media de ${avgDays} días desde la última visita`) : t('No patients overdue for recall', 'Ningún paciente pendiente de recuerdo') }}
    </p>
    <NuxtLink to="/recalls" class="mt-1.5 inline-block text-[12px] font-medium text-brand-text hover:text-brand-hover">{{ t('View recalls →', 'Ver recuerdos →') }}</NuxtLink>
  </div>
</template>
